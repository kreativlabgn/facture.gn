import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MerkleAnchorStatus, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { CERTIFICATION_SERVICE } from "../certification/certification.module";
import { resolveNifForCertification } from "../certification/certification.service";
import type { CertificationResult, CertificationService } from "../certification/certification.service";
import { OrganizationSigningKeyService } from "../certification/organization-signing-key.service";
import {
  buildInclusionProof,
  buildMerkleRoot,
  leafHash,
  type InclusionStep,
} from "../certification/merkle-anchor/merkle";
import { MAX_LEAVES_PER_BATCH } from "../certification/merkle-anchor/merkle-anchor.constants";

export interface PublicInvoiceVerification {
  certificationId: string;
  number: string;
  organizationName: string;
  // null pour une organisation sans NIF (B1/B4) — jamais le placeholder interne
  // (UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER) : honnêteté envers un vérificateur
  // externe (PRD §1.2, tiers de confiance).
  organizationNif: string | null;
  totalTtc: string;
  issuedAt: string;
  status: string;
  disputeStatus: string;
  validatedByAdministration: boolean;
  integrityValid: boolean;
  // A4, ADR-025 — distinct de integrityValid (recalcul cryptographique) : ce
  // champ répond à "la clé était-elle valide AU MOMENT de l'émission", jamais
  // à l'horloge courante. Toujours true pour la clé légataire globale
  // (signingKeyId null), qui n'a pas de registre de révocation dans ce repo.
  keyValidAtIssuance: boolean;
  // E1 (ADR-115) — preuve d'inclusion Merkle. null tant que la facture n'a pas
  // été scellée dans une tranche (job merkle-anchor-seal). Un vérificateur
  // reconstruit `leafHash → …inclusionProof… → merkleRoot`, puis (quand
  // externalAnchor.status === "anchored") vérifie `externalAnchor.proof` contre
  // le support externe (Bitcoin / IPFS).
  anchor: AnchorProof | null;
}

export interface AnchorProof {
  batchId: string;
  /** Borne haute exclusive réelle de la tranche. */
  asOf: string;
  /** Min(issuedAt) des factures de la tranche — période réellement engagée. */
  coverageFrom: string;
  merkleRoot: string;
  previousRoot: string;
  leafCount: number;
  leafHash: string;
  inclusionProof: InclusionStep[];
  // true ssi la racine reconstruite depuis les feuilles VIVANTES de la tranche
  // (+ leafCount) recolle avec `merkleRoot` immuable. false = le jeu de feuilles
  // a divergé (facture-sœur altérée/supprimée) — signal d'inaltérabilité, pas
  // une facture non ancrée.
  integrityConsistent: boolean;
  externalAnchor: {
    status: MerkleAnchorStatus;
    /** Preuve opaque (base64) opposable contre le support externe. null tant que non ancré. */
    proof: string | null;
    ref: string | null;
    anchoredAt: string | null;
  };
}

@Injectable()
export class VerificationService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    // A3, ADR-026 — clé globale légataire, UNIQUEMENT pour les factures signées
    // avant cette story (signingKeyId === null) — jamais utilisée pour une
    // facture signée par la clé propre de son organisation (voir branche
    // ci-dessous). Ne jamais migrer une facture existante de l'un vers l'autre.
    @Inject(CERTIFICATION_SERVICE) private readonly certification: CertificationService,
    private readonly signingKeyService: OrganizationSigningKeyService,
  ) {}

  // Recherche exclusivement par certification_id (jamais par l'id UUID interne, qui
  // n'est jamais destiné à être partagé publiquement — ADR-023).
  async verifyByCertificationId(certificationId: string): Promise<PublicInvoiceVerification> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { certificationId },
      include: { organization: true, anchorBatch: true },
    });

    if (!invoice || !invoice.number || !invoice.hash || !invoice.signature || !invoice.issuedAt) {
      throw new NotFoundException(
        "Aucune facture certifiée ne correspond à cet identifiant de vérification",
      );
    }

    // certify() est déterministe (même payload + même clé ⇒ même hash + même signature,
    // Ed25519 RFC 8032) : le recalcul depuis les champs actuellement stockés permet de
    // détecter une altération en base après signature, pas seulement une ligne absente.
    // A3, ADR-026 — signingKeyId null : facture signée avant cette story, la clé
    // globale légataire reste la seule référence valide (jamais retouchée).
    // Non-null : recalcul avec la clé propre de l'organisation référencée.
    const payload = {
      invoiceId: invoice.id,
      organizationNif: resolveNifForCertification(invoice.organization.nif),
      number: invoice.number,
      totalTtc: invoice.totalTtc,
      issuedAt: invoice.issuedAt.toISOString(),
      previousHash: invoice.previousHash ?? "GENESIS",
    };
    // A4, ADR-025 — un seul appel à verifyWithKey() fournit à la fois le
    // recalcul cryptographique ET le statut de révocation (revoke() de la même
    // ligne OrganizationSigningKey) : jamais un second aller-retour DB sur ce
    // endpoint public.
    let recomputed: CertificationResult;
    let revokedAt: Date | null = null;
    if (invoice.signingKeyId) {
      const result = await this.signingKeyService.verifyWithKey(invoice.signingKeyId, payload);
      recomputed = result;
      revokedAt = result.revokedAt;
    } else {
      // A3, ADR-026 — clé légataire globale, hors scope du registre de
      // révocation (aucun mécanisme de révocation pour cette clé dans ce repo).
      recomputed = this.certification.certify(payload);
    }

    const integrityValid =
      recomputed.hash === invoice.hash &&
      recomputed.certificationId === certificationId &&
      recomputed.signature === invoice.signature.toString("hex");

    // A4, ADR-025 — "révocation jamais rétroactive" : valide si jamais révoquée,
    // OU révoquée APRÈS issuedAt.
    const keyValidAtIssuance = revokedAt === null || invoice.issuedAt < revokedAt;

    // E1 — preuve d'inclusion reconstruite à la volée depuis les feuilles
    // VIVANTES de la tranche (invoice.hash, ordre total déterministe — le même
    // que le scellement). La racine reconstruite ET le compte de feuilles sont
    // repliés contre les valeurs immuables : un écart = jeu de feuilles divergé
    // (facture-sœur altérée / supprimée), signalé par integrityConsistent.
    let anchor: AnchorProof | null = null;
    const batch = invoice.anchorBatch;
    if (batch) {
      const leaves = await this.prisma.invoice.findMany({
        where: { anchorBatchId: invoice.anchorBatchId },
        select: { hash: true },
        orderBy: [{ hash: "asc" }, { id: "asc" }],
        // Défense en profondeur : la borne réelle est le plafond au scellement
        // (une tranche ne dépasse jamais MAX_LEAVES_PER_BATCH). Ce `take` garde
        // l'endpoint public borné même si le plafond de scellement est relevé
        // un jour sans revenir ici.
        take: MAX_LEAVES_PER_BATCH,
      });
      const leafHashes = leaves
        .map((l) => l.hash)
        .filter((h): h is string => h !== null);

      let integrityConsistent = false;
      let inclusionProof: InclusionStep[] = [];
      try {
        integrityConsistent =
          leafHashes.length === batch.leafCount && buildMerkleRoot(leafHashes) === batch.merkleRoot;
        if (integrityConsistent) {
          inclusionProof = buildInclusionProof(leafHashes, invoice.hash);
        }
      } catch {
        integrityConsistent = false;
      }

      anchor = {
        batchId: batch.id,
        asOf: batch.asOf.toISOString(),
        coverageFrom: batch.coverageFrom.toISOString(),
        merkleRoot: batch.merkleRoot,
        previousRoot: batch.previousRoot,
        leafCount: batch.leafCount,
        leafHash: leafHash(invoice.hash),
        inclusionProof,
        integrityConsistent,
        externalAnchor: {
          status: batch.anchorStatus,
          proof: batch.anchorProof,
          ref: batch.anchorRef,
          anchoredAt: batch.anchoredAt?.toISOString() ?? null,
        },
      };
    }

    return {
      certificationId,
      number: invoice.number,
      organizationName: invoice.organization.name,
      organizationNif: invoice.organization.nif,
      totalTtc: invoice.totalTtc.toString(),
      issuedAt: invoice.issuedAt.toISOString(),
      status: invoice.status,
      disputeStatus: invoice.disputeStatus,
      validatedByAdministration: invoice.validatedByAdministration,
      integrityValid,
      keyValidAtIssuance,
      anchor,
    };
  }
}
