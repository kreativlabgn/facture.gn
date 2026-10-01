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
import { scanAudioSchema, type ScanAudioDto } from "./dto/scan-audio.dto";
import { OcrVisionService } from "./ocr-vision.service";
import { ROLES_SAISIE } from "./ocr-roles";

// Réexporté pour ne rien casser côté import existant (plan 2026-09-16, OCR
// multicanal) — la constante vit désormais dans ocr-roles.ts pour être
// importée sans duplication par whatsapp-inbound.service.ts (lot suivant).
export { ROLES_SAISIE };

// Hub Vision (ADR-122, étendu par le plan 2026-09-16 — OCR multicanal). Même
// trio élargi que POST /invoices sur les TROIS routes : photographier une
// facture papier, la dicter au micro, ou l'envoyer par WhatsApp (lot suivant)
// pour en faire un brouillon est l'acte de saisie du comptoir, pas une action
// financière — le caissier et l'agent terrain y ont leur place. Pipe scopée
// au paramètre @Body(), jamais @UsePipes() au niveau méthode : le handler
// porte aussi @CurrentUser() (piège documenté dans zod-validation.pipe.ts).
//
// PRÉFIXE DE CONTRÔLEUR RACCOURCI À "ai/ocr" (ci-avant "ai/ocr/scans") pour
// accueillir /ai/ocr/audio-notes à côté de /ai/ocr/scans sans dupliquer un
// second contrôleur — chaque route reprécise son segment, AUCUNE URL
// existante ne change (POST/GET /ai/ocr/scans, GET /ai/ocr/scans/:id).
@ApiTags("ai")
@ApiBearerAuth()
@Controller("ai/ocr")
export class AiController {
  constructor(private readonly ocrVision: OcrVisionService) {}

  // Un appel au modèle par requête : plafond serré. Une PWA qui rejoue le même
  // cliché tombe sur l'idempotence AVANT le modèle, mais un client qui varie
  // l'empreinte à chaque essai ne doit pas pouvoir saturer le point d'inférence.
  @Post("scans")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Roles(...ROLES_SAISIE)
  scanner(
    @Body(new ZodValidationPipe(scanDocumentSchema)) dto: ScanDocumentDto,
    @CurrentOrganizationId() organizationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.ocrVision.scanner(dto, organizationId, user.id);
  }

  // AUDIO_PWA (plan 2026-09-16) — asynchrone : répond dès l'enregistrement et
  // l'enfilement du job de transcription, jamais après un appel modèle. Même
  // trio de garde exact que POST /ai/ocr/scans (rôles, throttle) : dicter une
  // facture est le même acte de saisie que la photographier.
  @Post("audio-notes")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Roles(...ROLES_SAISIE)
  recevoirAudio(
    @Body(new ZodValidationPipe(scanAudioSchema)) dto: ScanAudioDto,
    @CurrentOrganizationId() organizationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.ocrVision.recevoirAudio(dto, organizationId, user.id);
  }

  @Get("scans")
  @Roles(...ROLES_SAISIE)
  findAll(@Query(new ZodValidationPipe(listScansQuerySchema)) query: ListScansQueryDto) {
    return this.ocrVision.findAllByOrganization(query.organizationId, { status: query.status });
  }

  @Get("scans/:id")
  @Roles(...ROLES_SAISIE)
  @OrganizationIdSource("ocr-document")
  findOne(@Param("id") id: string, @CurrentOrganizationId() organizationId: string) {
    return this.ocrVision.findOne(id, organizationId);
  }
}
