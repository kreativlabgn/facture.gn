import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { whatsappWebhookSchema, type WhatsAppWebhookDto } from "./dto/whatsapp-webhook.dto";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WhatsAppWebhookAuthGuard } from "./whatsapp-webhook-auth.guard";

// Clarification 6 du plan 2026-09-16 (OCR multicanal) — SEULE surface
// publique non authentifiée par JWT de ce dépôt en dehors de v1/partners
// (webhook APIP). @Public() court-circuite JwtAuthGuard sur les DEUX routes ;
// WhatsAppWebhookAuthGuard (POST uniquement) est le seul vrai garde du corps
// entrant. Le handshake GET n'a AUCUN garde de classe — Meta ne signe pas
// cette requête ponctuelle de configuration, seule la comparaison à temps
// constant du jeton partagé (WHATSAPP_WEBHOOK_VERIFY_TOKEN) protège la route.
// @ApiExcludeController — jamais dans /docs (Swagger, non protégé par
// JwtAuthGuard/RolesGuard, voir main.ts) : cette route n'a de toute façon
// aucun intérêt pour un consommateur API interne facture.gn.
@ApiExcludeController()
@Controller("webhooks/whatsapp")
export class WhatsAppInboundController {
  private readonly verifyToken: string;

  constructor(private readonly inbound: WhatsAppInboundService) {
    const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!token) {
      throw new Error(
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN manquant — voir README pour générer le jeton de handshake webhook WhatsApp",
      );
    }
    this.verifyToken = token;
  }

  @Get()
  @Public()
  handshake(
    @Query("hub.verify_token") verifyToken: string | undefined,
    @Query("hub.challenge") challenge: string | undefined,
    @Res() res: Response,
  ): void {
    if (this.estJetonValide(verifyToken)) {
      // Content-Type explicite : Express fixe text/html par défaut sur
      // .send(string) — un hub.challenge non contrôlé (paramètre Meta,
      // reflété tel quel) répondu en text/html serait un vecteur XSS réfléchi
      // théorique si WHATSAPP_WEBHOOK_VERIFY_TOKEN venait un jour à fuiter.
      // La CSP helmet mitige déjà ce risque aujourd'hui, mais fixer le type à
      // text/plain retire la dépendance à cette mitigation indirecte.
      res.type("text/plain").status(200).send(challenge ?? "");
      return;
    }
    res.status(403).send("Jeton de vérification invalide");
  }

  // Répond TOUJOURS 200 à Meta si la signature est valide — même pour un
  // message ignoré côté métier (clarification 6). Le corps renvoyé est un
  // accusé TECHNIQUE, jamais le message vu par l'expéditeur (appel sortant
  // séparé, WHATSAPP_PROVIDER, dans whatsapp-inbound.service.ts).
  @Post()
  @Public()
  @UseGuards(WhatsAppWebhookAuthGuard)
  @HttpCode(200)
  async recevoir(
    @Body(new ZodValidationPipe(whatsappWebhookSchema)) body: WhatsAppWebhookDto,
  ): Promise<{ received: true }> {
    const messages = body.entry.flatMap((entry) => entry.changes.flatMap((change) => change.value.messages ?? []));
    for (const message of messages) {
      await this.inbound.traiterMessage(message);
    }
    return { received: true };
  }

  private estJetonValide(provided: string | undefined): boolean {
    if (typeof provided !== "string" || provided.length === 0) {
      return false;
    }
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(this.verifyToken);
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
