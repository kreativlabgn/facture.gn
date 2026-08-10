import { Inject, Injectable } from "@nestjs/common";
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

  async certifyForOrganization(
    organizationId: string,
    payload: CertifiablePayload,
  ): Promise<CertificationResult & { signingKeyId: string }> {
    const key = await this.prisma.organizationSigningKey.findUniqueOrThrow({ where: { organizationId } });
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return { ...service.certify(payload), signingKeyId: key.id };
  }

  async verifyWithKey(signingKeyId: string, payload: CertifiablePayload): Promise<CertificationResult> {
    const key = await this.prisma.organizationSigningKey.findUniqueOrThrow({ where: { id: signingKeyId } });
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return service.certify(payload);
  }

  private buildServiceFromEncryptedKey(encryptedPrivateKey: string): StubEd25519CertificationService {
    const privateKey = decryptPrivateKey(encryptedPrivateKey, this.masterKey);
    return new StubEd25519CertificationService(privateKey);
  }
}
