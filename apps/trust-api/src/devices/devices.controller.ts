import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CurrentOrganizationId } from "../common/rbac/current-organization-id.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { provisionDeviceSchema, type ProvisionDeviceDto } from "./dto/provision-device.dto";
import { enrollDeviceSchema, type EnrollDeviceDto } from "./dto/enroll-device.dto";
import { DevicesService } from "./devices.service";

// Chemin PME — imbriqué sous /organizations/:id, comme api-keys et
// bank-reconciliation : @Param("id") EST l'organisation, donc
// @OrganizationIdSource("organization") et pas de résolution "invoice" par défaut.
//
// Réservé owner/admin : enrôler un terminal, c'est autoriser une source
// d'émission de factures certifiées. Jamais un cashier — même posture que
// ApiKeysController (F15), dont les clés ouvrent un accès comparable.
@ApiTags("devices")
@ApiBearerAuth()
@Controller("organizations/:id/devices")
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  provision(
    @Param("id") _organizationId: string,
    @Body(new ZodValidationPipe(provisionDeviceSchema)) dto: ProvisionDeviceDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.devicesService.provision(organizationId, dto, user.id);
  }

  @Get()
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  list(@Param("id") _organizationId: string, @CurrentOrganizationId() organizationId: string) {
    return this.devicesService.list(organizationId);
  }

  @Post(":deviceId/revoke")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  revoke(
    @Param("id") _organizationId: string,
    @Param("deviceId") deviceId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.devicesService.revoke(organizationId, deviceId, user.id);
  }
}

// Chemin TERMINAL — le boîtier n'a ni compte ni session, il ne présente qu'un
// jeton. @Public() court-circuite JwtAuthGuard ; RolesGuard est un no-op sans
// @Roles(), donc @CurrentOrganizationId() lèverait ici : le service découvre
// l'organisation depuis le jeton (même schéma que
// PaymentsController.confirmProviderPayment, C2).
//
// Contrôleur SÉPARÉ et non une route @Public() au milieu du précédent : le :id
// de l'autre contrôleur est l'organisation, celui-ci n'en a aucun. Les mélanger
// rendrait la résolution du garde ambiguë — même précédent que
// CommissionBypassCasesController / CommissionBypassCaseResolutionController.
//
// Throttle serré : cette route est la seule atteignable sans authentification,
// donc la seule exploitable pour un balayage de jetons. Même valeur que les
// routes @Public() d'AuthController (Security Audit 2026-08-23, finding #10).
@ApiTags("devices")
@Controller("devices")
export class DeviceEnrollmentController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post("enroll")
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  enroll(@Body(new ZodValidationPipe(enrollDeviceSchema)) dto: EnrollDeviceDto) {
    return this.devicesService.enroll(dto);
  }
}
