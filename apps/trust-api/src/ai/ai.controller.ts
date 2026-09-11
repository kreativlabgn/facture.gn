import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentOrganizationId } from "../common/rbac/current-organization-id.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { Roles } from "../common/rbac/roles.decorator";
import {
  listScansQuerySchema,
  scanDocumentSchema,
  type ListScansQueryDto,
  type ScanDocumentDto,
} from "./dto/scan-document.dto";
import { OcrVisionService } from "./ocr-vision.service";

// Hub Vision (ADR-122). Même trio élargi que POST /invoices : photographier
// une facture papier pour en faire un brouillon est l'acte de saisie du
// comptoir, pas une action financière — le caissier et l'agent terrain y ont
// leur place. Pipe scopée au paramètre @Body(), jamais @UsePipes() au niveau
// méthode : le handler porte aussi @CurrentUser() (piège documenté dans
// zod-validation.pipe.ts).
const ROLES_SAISIE = ["owner", "admin", "accountant_internal", "cashier", "field_agent"] as const;

@ApiTags("ai")
@ApiBearerAuth()
@Controller("ai/ocr/scans")
export class AiController {
  constructor(private readonly ocrVision: OcrVisionService) {}

  // Un appel au modèle par requête : plafond serré. Une PWA qui rejoue le même
  // cliché tombe sur l'idempotence AVANT le modèle, mais un client qui varie
  // l'empreinte à chaque essai ne doit pas pouvoir saturer le point d'inférence.
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Roles(...ROLES_SAISIE)
  scanner(
    @Body(new ZodValidationPipe(scanDocumentSchema)) dto: ScanDocumentDto,
    @CurrentOrganizationId() organizationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.ocrVision.scanner(dto, organizationId, user.id);
  }

  @Get()
  @Roles(...ROLES_SAISIE)
  findAll(@Query(new ZodValidationPipe(listScansQuerySchema)) query: ListScansQueryDto) {
    return this.ocrVision.findAllByOrganization(query.organizationId, { status: query.status });
  }

  @Get(":id")
  @Roles(...ROLES_SAISIE)
  @OrganizationIdSource("ocr-document")
  findOne(@Param("id") id: string, @CurrentOrganizationId() organizationId: string) {
    return this.ocrVision.findOne(id, organizationId);
  }
}
