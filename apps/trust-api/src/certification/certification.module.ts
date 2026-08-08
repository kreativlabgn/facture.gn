import { Global, Module } from "@nestjs/common";
import { hexToBytes } from "@noble/hashes/utils";
import { StubEd25519CertificationService, type CertificationService } from "./certification.service";

export const CERTIFICATION_SERVICE = Symbol("CERTIFICATION_SERVICE");

// Sans clé persistée, chaque redémarrage du process régénérerait une clé Ed25519
// aléatoire : toute facture certifiée avant le restart échouerait la vérification
// publique (GET /verify) alors qu'elle n'a jamais été altérée — même pattern de
// fail-fast que JWT_PRIVATE_KEY (voir auth.module.ts). TODO(ADR-026/A3) : HSM cloud
// en production, jamais la clé en variable d'environnement.
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
  ],
  exports: [CERTIFICATION_SERVICE],
})
export class CertificationModule {}
