import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ussdRequestSchema, type UssdRequestDto } from "./dto/ussd-request.dto";
import { UssdSessionService } from "./ussd-session.service";

// @Public() : l'appelant est l'agrégateur USSD (Orange/tiers), jamais un
// utilisateur avec un JWT facture.gn — même principe que PartnersController
// (webhook APIP) et PaymentsController (webhook money-api).
@ApiTags("ussd")
@Controller("ussd")
export class UssdController {
  constructor(private readonly ussdSessionService: UssdSessionService) {}

  @Public()
  @Post("session")
  handle(@Body(new ZodValidationPipe(ussdRequestSchema)) dto: UssdRequestDto) {
    return this.ussdSessionService.handleRequest(dto.sessionId, dto.phone, dto.input);
  }
}
