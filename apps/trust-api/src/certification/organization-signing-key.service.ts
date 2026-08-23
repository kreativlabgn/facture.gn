import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { decryptPrivateKey, encryptPrivateKey } from "./envelope-encryption";
import {
  StubEd25519CertificationService,
  type CertifiablePayload,
  type CertificationResult,
} from "./certification.service";

// A3, ADR-026 — une clé racine Ed25519 par organisation, jamais en clair au
// repos (chiffrement enveloppe, envelope-encryption.ts). Remplace le
// CertificationService global légataire pour TOUTE nouvelle facture — celui-ci
// reste utilisé UNIQUEMENT pour vérifier les factures déjà signées avant cette
// story (Invoice.signingKeyId === null), jamais retouchées.
@Injectable()
export class OrganizationSigningKeyService {
  private readonly masterKey: Buffer;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {
    const value = process.env.CERTIFICATION_MASTER_KEY;
    if (!value) {
      throw new Error(
        "CERTIFICATION_MASTER_KEY manquant — voir README pour générer le secret de chiffrement enveloppe",
      );
    }
    this.masterKey = Buffer.from(value, "hex");
  }

  async provisionRootKey(organizationId: string, tx?: Prisma.TransactionClient) {
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
    const encryptedPrivateKey = encryptPrivateKey(privateKey, this.masterKey);

    const client = tx ?? this.prisma;
    return client.organizationSigningKey.create({
      data: { organizationId, publicKey, encryptedPrivateKey },
    });
  }

  // Quality Audit 2026-08-23, revue post-fix #1 — tx optionnel (même précédent
  // que provisionRootKey ci-dessus) : cette méthode n'effectue AUCUNE écriture
  // (lecture de la clé + calcul de signature Ed25519 pur, en mémoire), donc il
  // n'y a pas de "trou" possible ici contrairement à nextNumber() — mais lire
  // via tx plutôt que le client global garde la lecture de la clé dans la même
  // snapshot Postgres que le reste de la transaction issue() (cohérence avec
  // une révocation concurrente de la clé, ADR-025), sans changer le contrat.
  async certifyForOrganization(
    organizationId: string,
    payload: CertifiablePayload,
    tx?: Prisma.TransactionClient,
  ): Promise<CertificationResult & { signingKeyId: string }> {
    const client = tx ?? this.prisma;
    const key = await client.organizationSigningKey.findUniqueOrThrow({ where: { organizationId } });
    // A4, ADR-025 — garde additive, jamais rétroactive : bloque uniquement de
    // NOUVELLES signatures, ne touche jamais verifyWithKey() (intégrité des
    // factures déjà signées avant la révocation).
    if (key.revokedAt) {
      throw new ConflictException(
        `La clé de signature de l'organisation ${organizationId} a été révoquée le ${key.revokedAt.toISOString()} — aucune nouvelle facture ne peut être émise`,
      );
    }
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return { ...service.certify(payload), signingKeyId: key.id };
  }

  // A4, ADR-025 — self-service owner/admin, jamais un workflow d'approbation
  // (contrairement à CreditLimitChangeRequest, E5) : une clé compromise doit
  // pouvoir être révoquée immédiatement. Idempotent : un second appel ne
  // réécrit jamais revokedAt (préserve l'horodatage exact de la 1ère révocation,
  // dont dépend keyValidAtIssuance côté VerificationService).
  async revoke(organizationId: string) {
    const key = await this.prisma.organizationSigningKey.findUniqueOrThrow({ where: { organizationId } });
    if (key.revokedAt) {
      return key;
    }

    return this.prisma.organizationSigningKey.update({
      where: { organizationId },
      data: { revokedAt: new Date() },
    });
  }

  // A4, ADR-025 — revokedAt inclus dans le résultat (jamais un second lookup
  // séparé, revue dev-code-reviewer) : verifyWithKey() a déjà la ligne
  // OrganizationSigningKey en main, un getRevokedAt() dédié aurait requêté la
  // MÊME ligne une seconde fois sur le endpoint public de vérification.
  async verifyWithKey(
    signingKeyId: string,
    payload: CertifiablePayload,
  ): Promise<CertificationResult & { revokedAt: Date | null }> {
    const key = await this.prisma.organizationSigningKey.findUniqueOrThrow({ where: { id: signingKeyId } });
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return { ...service.certify(payload), revokedAt: key.revokedAt };
  }

  private buildServiceFromEncryptedKey(encryptedPrivateKey: string): StubEd25519CertificationService {
    const privateKey = decryptPrivateKey(encryptedPrivateKey, this.masterKey);
    return new StubEd25519CertificationService(privateKey);
  }
}
