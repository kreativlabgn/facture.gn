import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import type { OrganizationSigningKey, Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { decryptPrivateKey, encryptPrivateKey } from "./envelope-encryption";
import {
  StubEd25519CertificationService,
  type CertifiablePayload,
  type CertificationResult,
} from "./certification.service";

// DAT §Crypto — "rotation 365j". Cible, matérialisée par l'indicateur
// rotationDue de getKeyStatus(). Auto-rotation = fast-follow (voir PLAN E3).
const ROTATION_INTERVAL_DAYS = 365;

export interface SigningKeyStatus {
  active: boolean;
  publicKey?: string;
  createdAt?: Date;
  ageInDays?: number;
  rotationDue?: boolean;
  revokedAt?: Date | null;
  retiredKeyCount?: number;
}

/** Métadonnées publiques d'une clé — jamais encryptedPrivateKey. */
function publicView(key: OrganizationSigningKey): Pick<OrganizationSigningKey, "id" | "organizationId" | "publicKey" | "createdAt" | "retiredAt" | "revokedAt"> {
  return {
    id: key.id,
    organizationId: key.organizationId,
    publicKey: key.publicKey,
    createdAt: key.createdAt,
    retiredAt: key.retiredAt,
    revokedAt: key.revokedAt,
  };
}

// A3, ADR-026 — une clé racine Ed25519 par organisation, jamais en clair au
// repos (chiffrement enveloppe, envelope-encryption.ts).
// E3 (ADR-114) — N clés dans le temps, AU PLUS UNE active (retiredAt IS NULL AND
// revoked_at IS NULL — index unique partiel organization_signing_key_one_active_per_org).
// verifyWithKey() suit Invoice.signingKeyId (la clé EXACTE), jamais "la clé
// courante" : une facture déjà signée n'est jamais re-vérifiée différemment.
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

  // E3 — rotation de la clé racine : retire l'active, en provisionne une neuve.
  // Transaction : le retrait et la création sont atomiques. Course concurrente
  // → P2002 sur l'index partiel "une seule active" → ConflictException.
  async rotate(organizationId: string): Promise<ReturnType<typeof publicView>> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const current = await tx.organizationSigningKey.findFirst({
          where: { organizationId, retiredAt: null },
        });
        // Une clé active déjà révoquée n'est pas "retirée" (revokedAt reste la
        // trace forensique) — on provisionne simplement une nouvelle active.
        if (current && !current.revokedAt) {
          await tx.organizationSigningKey.update({
            where: { id: current.id },
            data: { retiredAt: new Date() },
          });
        }
        return this.provisionRootKey(organizationId, tx);
      });
      return publicView(created);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException(
          `Une rotation de la clé de signature de l'organisation ${organizationId} est déjà en cours`,
        );
      }
      throw error;
    }
  }

  async certifyForOrganization(
    organizationId: string,
    payload: CertifiablePayload,
    tx?: Prisma.TransactionClient,
  ): Promise<CertificationResult & { signingKeyId: string }> {
    const client = tx ?? this.prisma;
    const key = await client.organizationSigningKey.findFirst({
      where: { organizationId, retiredAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!key) {
      throw new ConflictException(
        `L'organisation ${organizationId} n'a aucune clé de signature active — une rotation est requise avant d'émettre`,
      );
    }
    // A4, ADR-025 — garde additive, jamais rétroactive : bloque uniquement de
    // NOUVELLES signatures, ne touche jamais verifyWithKey().
    if (key.revokedAt) {
      throw new ConflictException(
        `La clé de signature de l'organisation ${organizationId} a été révoquée le ${key.revokedAt.toISOString()} — aucune nouvelle facture ne peut être émise`,
      );
    }
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return { ...service.certify(payload), signingKeyId: key.id };
  }

  // A4, ADR-025 — self-service owner/admin. Révoque la clé ACTIVE (cas courant :
  // "ma clé courante a fuité"). Idempotent : ne réécrit jamais revokedAt.
  async revoke(organizationId: string) {
    const key = await this.prisma.organizationSigningKey.findFirst({
      where: { organizationId, retiredAt: null },
    });
    if (!key) {
      throw new NotFoundException(
        `L'organisation ${organizationId} n'a aucune clé de signature active à révoquer`,
      );
    }
    if (key.revokedAt) {
      return key;
    }

    return this.prisma.organizationSigningKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });
  }

  // A4, ADR-025 — revokedAt inclus dans le résultat (jamais un second lookup) :
  // verifyWithKey() a déjà la ligne OrganizationSigningKey en main.
  async verifyWithKey(
    signingKeyId: string,
    payload: CertifiablePayload,
  ): Promise<CertificationResult & { revokedAt: Date | null }> {
    const key = await this.prisma.organizationSigningKey.findUniqueOrThrow({ where: { id: signingKeyId } });
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return { ...service.certify(payload), revokedAt: key.revokedAt };
  }

  // E3 — état de la clé active pour l'UI (indicateur "rotation due").
  async getKeyStatus(organizationId: string): Promise<SigningKeyStatus> {
    const [active, retiredKeyCount] = await Promise.all([
      this.prisma.organizationSigningKey.findFirst({ where: { organizationId, retiredAt: null } }),
      this.prisma.organizationSigningKey.count({ where: { organizationId, retiredAt: { not: null } } }),
    ]);

    if (!active) {
      return { active: false, retiredKeyCount };
    }

    const ageInDays = Math.floor((Date.now() - active.createdAt.getTime()) / (24 * 3600_000));
    return {
      active: true,
      publicKey: active.publicKey,
      createdAt: active.createdAt,
      ageInDays,
      rotationDue: ageInDays > ROTATION_INTERVAL_DAYS,
      revokedAt: active.revokedAt,
      retiredKeyCount,
    };
  }

  private buildServiceFromEncryptedKey(encryptedPrivateKey: string): StubEd25519CertificationService {
    const privateKey = decryptPrivateKey(encryptedPrivateKey, this.masterKey);
    return new StubEd25519CertificationService(privateKey);
  }
}
