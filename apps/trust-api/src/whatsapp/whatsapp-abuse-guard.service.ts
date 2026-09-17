import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { OCR_PIPELINE_QUEUE } from "../ai/ocr-pipeline.constants";
import { WHATSAPP_OCR_HOURLY_LIMIT } from "./whatsapp.constants";

// Clarification 6, point 7 du plan 2026-09-16 — anti-abus PAR ORGANISATION
// RÉSOLUE, jamais par IP : tout le trafic Meta Cloud API sort d'un pool d'IP
// partagé par TOUTES les PME clientes de facture.gn ; un throttle IP
// (ThrottlerModule, déjà global, 100/60 s) protège la plateforme entière,
// jamais UNE organisation qui spammerait le hub STT/Vision. Compteur Redis
// `whatsapp-ocr:{organizationId}:{heure}` (INCR + EXPIRE 3600), plafond 30
// soumissions/organisation/heure — arbitraire mais documenté comme tel
// (whatsapp.constants.ts), du même ordre que les 20/60 s de POST /ai/ocr/scans.
//
// bullmq expose `client` (Promise<ioredis>) sur QueueBase depuis la v3, mais
// le getter est `protected` dans les types publics — surface minimale typée
// localement, MÊME PRÉCÉDENT que RedisHealthIndicator (money-api/src/health) :
// JAMAIS une seconde connexion Redis dédiée, réutilise celle DÉJÀ configurée
// pour la file ocr-pipeline (QueueModule, @Global).
type QueueWithClient = {
  client: Promise<{
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
  }>;
};

const FENETRE_SECONDES = 3600;

@Injectable()
export class WhatsAppAbuseGuardService {
  constructor(@InjectQueue(OCR_PIPELINE_QUEUE) private readonly queue: Queue) {}

  async estAutorise(organizationId: string): Promise<boolean> {
    const cle = this.cle(organizationId);
    const client = await (this.queue as unknown as QueueWithClient).client;
    const compte = await client.incr(cle);
    if (compte === 1) {
      // Première soumission de CETTE clé (donc de cette heure calendaire) :
      // pose l'expiration UNE SEULE FOIS. La réarmer à chaque appel
      // transformerait un plafond "par heure calendaire" en fenêtre glissante
      // sans fin (un flux continu de soumissions ne libérerait jamais la clé).
      await client.expire(cle, FENETRE_SECONDES);
    }
    return compte <= WHATSAPP_OCR_HOURLY_LIMIT;
  }

  // Une clé PAR HEURE ENTIÈRE (epoch ms / 3 600 000, tronqué) — deux
  // soumissions à 09:59 et 10:01 ne partagent jamais le même compteur, sans
  // dépendre d'un TTL glissant pour délimiter la fenêtre.
  private cle(organizationId: string): string {
    const heure = Math.floor(Date.now() / (FENETRE_SECONDES * 1000));
    return `whatsapp-ocr:${organizationId}:${heure}`;
  }
}
