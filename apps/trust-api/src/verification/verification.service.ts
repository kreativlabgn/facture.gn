import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { CERTIFICATION_SERVICE } from "../certification/certification.module";
import { resolveNifForCertification } from "../certification/certification.service";
import type { CertificationService } from "../certification/certification.service";
import { OrganizationSigningKeyService } from "../certification/organization-signing-key.service";

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
      include: { organization: true },
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
    const recomputed = invoice.signingKeyId
      ? await this.signingKeyService.verifyWithKey(invoice.signingKeyId, payload)
      : this.certification.certify(payload);

    const integrityValid =
      recomputed.hash === invoice.hash &&
      recomputed.certificationId === certificationId &&
      recomputed.signature === invoice.signature.toString("hex");

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
    };
  }
}
