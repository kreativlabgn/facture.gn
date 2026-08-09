import { Body, Controller, Param, Post, UsePipes } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "./current-user.decorator";
import { Public } from "./public.decorator";
import { AuthService } from "./auth.service";
import { registerSchema, type RegisterDto } from "./dto/register.dto";
import { loginSchema, type LoginDto } from "./dto/login.dto";
import { requestRecoverySchema, type RequestRecoveryDto } from "./dto/request-recovery.dto";
import { addPhoneSchema, type AddPhoneDto } from "./dto/add-phone.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  @UsePipes(new ZodValidationPipe(registerSchema))
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post("login")
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Public : c'est le seul moyen pour un owner qui a perdu l'accès de déclencher
  // une récupération (B3). Réponse anti-énumération gérée dans le service.
  @Public()
  @Post("recovery-requests")
  @UsePipes(new ZodValidationPipe(requestRecoverySchema))
  requestRecovery(@Body() dto: RequestRecoveryDto) {
    return this.authService.requestRecovery(dto);
  }

  // JWT requis (l'approbateur doit être authentifié) — jamais @Public(), jamais
  // @Roles() : la vérification owner/admin est spécifique à l'organisation de la
  // demande, pas résoluble par RolesGuard.resolveOrganizationId() (params.id pointe
  // ici vers une demande de récupération, pas une facture).
  @Post("recovery-requests/:id/approve")
  @ApiBearerAuth()
  approveRecovery(@Param("id") id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.authService.resolveRecovery(id, user.id, "approved");
  }

  @Post("recovery-requests/:id/reject")
  @ApiBearerAuth()
  rejectRecovery(@Param("id") id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.authService.resolveRecovery(id, user.id, "rejected");
  }

  // JWT requis (B6) — jamais @Public() : on ajoute un numéro au compte déjà
  // authentifié, pas à un compte anonyme. Pipe scopé à @Body() (pas @UsePipes() au
  // niveau méthode, qui s'appliquerait aussi à @CurrentUser() et échouerait le même
  // schéma de validation — piège déjà documenté dans organizations.controller.ts).
  @Post("phones")
  @ApiBearerAuth()
  addPhone(@Body(new ZodValidationPipe(addPhoneSchema)) dto: AddPhoneDto, @CurrentUser() user: CurrentUserPayload) {
    return this.authService.addPhone(user.id, dto.msisdn, dto.password);
  }
}
