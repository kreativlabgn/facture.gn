import { Global, Module } from "@nestjs/common";
import { StubEd25519CertificationService, type CertificationService } from "./certification.service";

export const CERTIFICATION_SERVICE = Symbol("CERTIFICATION_SERVICE");

@Global()
@Module({
  providers: [
    {
      provide: CERTIFICATION_SERVICE,
      useFactory: (): CertificationService => new StubEd25519CertificationService(),
    },
  ],
  exports: [CERTIFICATION_SERVICE],
})
export class CertificationModule {}
