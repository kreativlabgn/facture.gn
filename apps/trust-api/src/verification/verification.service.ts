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
  // ADR-118/e1 — CONTINUITÉ DE LA CHAÎNE, distincte d'integrityValid.
  //
  //   integrityValid  répond de LA facture : ses champs actuels redonnent-ils le
  //                   hash et la signature stockés ?
  //   chainValid      répond du REGISTRE : la facture s'insère-t-elle dans une
  //                   chaîne continue, sans fourche ni maillon manquant ?
  //
  // Les deux sont indépendants, et c'est tout l'intérêt : une facture peut être
  // parfaitement signée (integrityValid: true) tout en appartenant à un registre
  // forké (chainValid: false). `previousHash` entre dans le payload signé, donc
  // il ne peut pas être falsifié sans casser integrityValid — mais rien ne
  // garantissait jusqu'ici qu'il DÉSIGNE une facture réellement existante.
  chainValid: boolean;
  // null quand chainValid vaut true. Nommé chainError et non `error` : au même
  // niveau qu'integrityValid et keyValidAtIssuance, un champ `error` nu se
  // lirait comme « la requête a échoué », ce qui n'est pas le cas — la réponse
  // est un verdict complet, pas une erreur HTTP.
  chainError: string | null;
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
  // RLS (ADR-111 étape 1) — CE SERVICE RESTE ENTIÈREMENT NON SCOPÉ, à dessein.
  // C'est le point d'entrée PUBLIC de vérification : n'importe qui doit pouvoir
  // vérifier une facture certifiée sans appartenir à l'organisation émettrice —
  // c'est tout l'objet du dispositif de confiance. Aucun appelant n'a
  // d'organisation à fournir, et en poser une rendrait l'endpoint inutilisable
  // pour un tiers vérificateur.
  //
  // La reconstruction de la preuve Merkle (plus bas) est doublement
  // non scopable : un lot d'ancrage rassemble les factures de TOUTES les
  // organisations, et la racine ne se recalcule qu'avec l'intégralité des
  // feuilles. Un GUC y produirait une racine fausse, donc une vérification
  // faussement négative.
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

    const { chainValid, chainError } = await this.verifyChainContinuity(invoice);

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
      chainValid,
      chainError,
      keyValidAtIssuance,
      anchor,
    };
  }

  // ADR-118/e1 — continuité du chaînage Ed25519 par organisation.
  //
  // LECTURE GLOBALE, non scopée, à dessein : le vérificateur est public et ne
  // porte aucune organisation (voir la carte RLS en tête de
  // verifyByCertificationId). Poser un GUC ici rendrait le contrôle impossible.
  //
  // COÛT BORNÉ. Au plus une lecture indexée + une vérification Ed25519, quelle
  // que soit la longueur de la chaîne. On ne remonte JAMAIS la chaîne entière :
  // ce serait O(n) sur un endpoint public, donc un levier de déni de service.
  // Chaque maillon se vérifie par son propre appel à cet endpoint.
  private async verifyChainContinuity(invoice: {
    id: string;
    organizationId: string;
    previousHash: string | null;
  }): Promise<{ chainValid: boolean; chainError: string | null }> {
    const previousHash = invoice.previousHash ?? "GENESIS";

    // ── Cas 1 : la facture se déclare TÊTE de chaîne ──────────────────────────
    // Une organisation ne peut en avoir qu'une seule. Deux têtes = le registre a
    // fourché — c'est exactement la trace laissée par le bug de chaînage corrigé
    // en 5e4f203 (un brouillon annulé passait le filtre du prédécesseur, la
    // facture suivante repartait à GENESIS). Ce contrôle-là est indispensable :
    // sans lui, la cicatrice réelle resterait invisible, puisqu'aucun maillon ne
    // manque — il y en a deux de trop.
    if (previousHash === "GENESIS") {
      const autresTetes = await this.prisma.invoice.count({
        where: {
          organizationId: invoice.organizationId,
          issuedAt: { not: null },
          previousHash: "GENESIS",
          id: { not: invoice.id },
        },
      });
      if (autresTetes > 0) {
        return {
          chainValid: false,
          chainError:
            "Rupture de graphe en amont : plusieurs factures de cette organisation se déclarent tête de chaîne",
        };
      }
      return { chainValid: true, chainError: null };
    }

    // ── Cas 2 : un prédécesseur est désigné ──────────────────────────────────
    const predecesseur = await this.prisma.invoice.findFirst({
      where: {
        organizationId: invoice.organizationId,
        hash: previousHash,
        issuedAt: { not: null },
      },
      include: { organization: true },
    });

    if (!predecesseur || !predecesseur.number || !predecesseur.issuedAt) {
      return {
        chainValid: false,
        chainError: "Rupture de graphe en amont : aucune facture émise ne correspond au hash précédent",
      };
    }

    // Le prédécesseur est RECALCULÉ, jamais cru sur parole. Sans cela, une
    // altération de sa colonne `hash` suffirait à fabriquer un maillon
    // cohérent en apparence : la recherche ci-dessus le trouverait, et le
    // chaînage semblerait intact alors que le prédécesseur est corrompu.
    const payloadPrecedent = {
      invoiceId: predecesseur.id,
      organizationNif: resolveNifForCertification(predecesseur.organization.nif),
      number: predecesseur.number,
      totalTtc: predecesseur.totalTtc,
      issuedAt: predecesseur.issuedAt.toISOString(),
      previousHash: predecesseur.previousHash ?? "GENESIS",
    };
    const recalcule = predecesseur.signingKeyId
      ? await this.signingKeyService.verifyWithKey(predecesseur.signingKeyId, payloadPrecedent)
      : this.certification.certify(payloadPrecedent);

    if (recalcule.hash !== previousHash) {
      return {
        chainValid: false,
        chainError: "Rupture de graphe en amont : le hash recalculé du prédécesseur ne correspond pas",
      };
    }

    return { chainValid: true, chainError: null };
  }
}
