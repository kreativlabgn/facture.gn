import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { VerificationService } from "./verification.service";

@ApiTags("verification")
@Controller("verify")
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  // Accessible sans compte ni JWT (Ousmane, une banque, la DGI) — c'est le point
  // d'entrée du Trust Layer indépendant de facture.gn (ADR-041).
  @Get(":certificationId")
  @Public()
  verify(@Param("certificationId") certificationId: string) {
    return this.verificationService.verifyByCertificationId(certificationId);
  }
}
