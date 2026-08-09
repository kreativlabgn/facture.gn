import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { createPracticeSchema, type CreatePracticeDto } from "./dto/create-practice.dto";
import { PracticesService } from "./practices.service";

@ApiTags("practices")
@ApiBearerAuth()
@Controller("practices")
export class PracticesController {
  constructor(private readonly practicesService: PracticesService) {}

  // Aucun rôle requis : une practice n'est PAS scopée à une organisation existante
  // (ADR-068, entité de premier niveau parallèle) — n'importe quel utilisateur
  // authentifié peut en créer une, il en devient automatiquement practice_admin
  // (voir service). Même principe que OrganizationsController.create().
  @Post()
  create(
    @Body(new ZodValidationPipe(createPracticeSchema)) dto: CreatePracticeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.create(dto, user.id);
  }
}
