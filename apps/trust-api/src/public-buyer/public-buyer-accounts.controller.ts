import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import {
  createPublicBuyerAccountSchema,
  type CreatePublicBuyerAccountDto,
} from "./dto/create-public-buyer-account.dto";
import { PublicBuyerAccountsService } from "./public-buyer-accounts.service";

@ApiTags("PublicBuyer")
@ApiBearerAuth()
@Controller("public-buyer-accounts")
export class PublicBuyerAccountsController {
  constructor(private readonly publicBuyerAccountsService: PublicBuyerAccountsService) {}

  // Aucun @Roles() : un compte acheteur public n'est PAS scopé à une
  // organisation PME existante (même principe que PracticesController.create()).
  @Post()
  create(
    @Body(new ZodValidationPipe(createPublicBuyerAccountSchema)) dto: CreatePublicBuyerAccountDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.publicBuyerAccountsService.create(dto, user.id);
  }

  // Sélecteur PME (F16) : choix libre parmi les comptes actifs, même pattern que
  // GET /practices pour les CGA.
  @Get()
  listActive() {
    return this.publicBuyerAccountsService.listActive();
  }
}
