import { Global, Module } from "@nestjs/common";
import { hexToBytes } from "@noble/hashes/utils";
import { StubEd25519CertificationService, type CertificationService } from "./certification.service";
import { OrganizationSigningKeyService } from "./organization-signing-key.service";

export const CERTIFICATION_SERVICE = Symbol("CERTIFICATION_SERVICE");

// A3, ADR-026 — cette clé UNIQUE GLOBALE reste en place UNIQUEMENT pour
// vérifier les factures signées AVANT l'introduction des clés par organisation
// (Invoice.signingKeyId === null, voir OrganizationSigningKeyService ci-dessous
// pour toute nouvelle facture) — jamais retouchée, jamais utilisée pour signer
// une nouvelle facture. Sans clé persistée, chaque redémarrage du process
// régénérerait une clé Ed25519 aléatoire : toute facture légataire échouerait
// la vérification publique (GET /verify) alors qu'elle n'a jamais été altérée —
// même pattern de fail-fast que JWT_PRIVATE_KEY (voir auth.module.ts).
function readPrivateKeyFromEnv(): Uint8Array {
  const value = process.env.CERTIFICATION_PRIVATE_KEY;
  if (!value) {
    throw new Error(
      "CERTIFICATION_PRIVATE_KEY manquant — voir README pour générer une clé Ed25519 de dev",
    );
  }
  return hexToBytes(value);
}

@Global()
@Module({
  providers: [
    {
      provide: CERTIFICATION_SERVICE,
      useFactory: (): CertificationService => new StubEd25519CertificationService(readPrivateKeyFromEnv()),
    },
    OrganizationSigningKeyService,
  ],
  exports: [CERTIFICATION_SERVICE, OrganizationSigningKeyService],
})
export class CertificationModule {}
