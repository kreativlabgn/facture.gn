import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { msisdnSchema } from "../auth/dto/register.dto";
import { ROLES_SAISIE } from "../ai/ocr-roles";
import { OcrVisionService } from "../ai/ocr-vision.service";
import type { NotificationProvider } from "../notifications/notification-provider.interface";
import { WHATSAPP_PROVIDER } from "../notifications/notifications.tokens";
import { WhatsAppAbuseGuardService } from "./whatsapp-abuse-guard.service";
import { WHATSAPP_MEDIA_RELAY, WhatsAppMediaRelayIndisponible, type WhatsAppMediaRelay } from "./whatsapp-media-relay.service";
import type { WhatsAppInboundMessage } from "./dto/whatsapp-webhook.dto";

// Clarification 6 du plan 2026-09-16 (OCR multicanal) — résolution
// expéditeur → organisation, DANS CET ORDRE EXACT. Chaque étape a une réponse
// WhatsApp DISTINCTE, sauf les étapes 1-2 (numéro inconnu / connu non
// vérifié) qui partagent DÉLIBÉRÉMENT le MÊME message littéral — c'est
// l'invariant anti-fuite central de ce fichier, verrouillé par un test qui
// compare les deux chaînes.
//
// 1. Normaliser `from` (msisdnSchema, auth/dto/register.dto.ts — réutilisé,
//    jamais redupliqué).
// 2. UserPhone.findUnique({msisdn}) absent → message générique.
// 3. UserPhone.verifiedAt IS NOT NULL exigé — sinon MÊME message générique
//    qu'un numéro inconnu (ne jamais révéler qu'un numéro EST enregistré mais
//    pas encore vérifié).
// 4. OrganizationMember.findMany({userId, revokedAt: null}) — différent de 1
//    → message "ouvrez l'app" (couvre 0 et multi-organisation, hors scope).
// 5. Rôle hors ROLES_SAISIE → message EXPLICITE et DISTINCT (l'identité EST
//    confirmée ici, l'expliquer ne fuit rien).
// 6. organization.whatsappOcrEnabled === false → message explicite.
// 7. Déduplication sur whatsappMessageId (le wamid Meta, @unique GLOBAL) → si
//    déjà vu, AUCUN appel à OcrVisionService, réponse 200 silencieuse (pas de
//    second message WhatsApp sortant à l'expéditeur). AVANT l'anti-abus,
//    délibérément : sinon une redélivraison Meta du même message consomme
//    deux fois le quota anti-abus pour une seule soumission utilisateur.
// 8. Anti-abus (WhatsAppAbuseGuardService) → message explicite, AUCUN appel à
//    OcrVisionService.
// 9. Type de message non supporté → réponse pédagogique, jamais un crash.
// 10. Chemin heureux texte → OcrVisionService.recevoirMessageWhatsapp().
// 11. Chemin heureux audio (Étape 3 du plan) → relais média (télécharge chez
//     Meta, dépose dans MinIO via WhatsAppMediaRelayService), PUIS
//     OcrVisionService.recevoirMessageWhatsapp(kind: "audio"). Échec du relais
//     (WhatsAppMediaRelayIndisponible, la SEULE exception typée que ce service
//     rattrape ici) → message WhatsApp dédié, JAMAIS OcrVisionService appelé —
//     distinct de MESSAGE_TYPE_NON_SUPPORTE : ce n'est pas un type de message
//     non géré, c'est un échec technique transitoire (Meta ou MinIO
//     injoignables, jeton expiré). Toute AUTRE exception continue de remonter
//     (fail loud — un bug réel ne doit jamais se travestir en message
//     générique à l'utilisateur).
//
// 200 À META ≠ RÉPONSE À L'UTILISATEUR — cette méthode ne renvoie jamais de
// corps HTTP : le contrôleur répond systématiquement 200 à Meta (accusé
// technique, sans quoi Meta relivre le webhook en boucle) une fois que cette
// méthode a terminé, que le message ait été traité, ignoré, ou refusé. Le
// message vu par l'expéditeur est TOUJOURS un appel SORTANT séparé
// (WHATSAPP_PROVIDER), jamais le corps de la réponse webhook.

const MESSAGE_INSCRIPTION =
  "Ce numéro n'est associé à aucun compte facture.gn. Inscrivez-vous sur https://facture.gn pour utiliser ce canal.";
const MESSAGE_OUVRIR_APP =
  "Impossible de déterminer votre organisation depuis ce numéro. Ouvrez l'application facture.gn pour saisir votre facture.";
const MESSAGE_ROLE_INSUFFISANT =
  "Votre rôle ne permet pas cette action. Contactez l'administrateur de votre organisation.";
const MESSAGE_CANAL_DESACTIVE =
  "Le canal WhatsApp n'est pas activé pour votre organisation. Un owner ou un admin peut l'activer depuis les paramètres de l'organisation, dans l'application facture.gn.";
const MESSAGE_PLAFOND = "Trop de documents envoyés — réessayez dans une heure.";
const MESSAGE_TYPE_NON_SUPPORTE = "Je ne sais lire qu'un texte ou une note vocale pour le moment.";
// Distinct de MESSAGE_TYPE_NON_SUPPORTE (étape 3 du plan) — un échec du relais
// média n'est PAS un type de message non géré, c'est une panne transitoire
// (Meta ou le stockage objet injoignables, jeton expiré) : le dire clairement
// évite qu'un commerçant abandonne le canal WhatsApp en croyant la note
// vocale structurellement non supportée.
const MESSAGE_RELAIS_INDISPONIBLE =
  "Le relais audio est temporairement indisponible, réessayez ou envoyez votre facture par texte.";

@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: NotificationProvider,
    private readonly abuseGuard: WhatsAppAbuseGuardService,
    private readonly ocrVision: OcrVisionService,
    // EN DERNIÈRE POSITION — même précédent que CustomersService dans
    // OcrVisionService : ajouter un paramètre à la fin ne décale aucun des
    // arguments positionnels déjà utilisés par les tests existants.
    @Inject(WHATSAPP_MEDIA_RELAY) private readonly mediaRelay: WhatsAppMediaRelay,
  ) {}

  async traiterMessage(message: WhatsAppInboundMessage): Promise<void> {
    // Étape 1 — normalisation. Meta envoie `from` en E.164 SANS le préfixe
    // "+" (ex. "224620000000") ; msisdnSchema exige "+224XXXXXXXXX".
    const candidat = message.from.startsWith("+") ? message.from : `+${message.from}`;
    const msisdn = msisdnSchema.safeParse(candidat);
    if (!msisdn.success) {
      // Fail-closed : un format hors norme n'est jamais rejeté en silence,
      // mais jamais non plus traité comme un numéro identifié — même réponse
      // que le cas générique, sur le meilleur numéro dont on dispose.
      await this.repondre(candidat, MESSAGE_INSCRIPTION);
      return;
    }
    const phone = msisdn.data;

    // Étapes 2-3 — numéro inconnu OU jamais vérifié : MÊME message, à la
    // lettre. Un `UserPhone` est hors RLS (identité partagée, voir
    // organizations.service.ts) — lecture non scopée à dessein, la question
    // est justement "à quelle organisation appartient CE numéro".
    const userPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: phone } });
    if (!userPhone || !userPhone.verifiedAt) {
      await this.repondre(phone, MESSAGE_INSCRIPTION);
      return;
    }

    // Étape 4 — 0 ou plusieurs organisations actives.
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId: userPhone.userId, revokedAt: null },
    });
    if (memberships.length !== 1) {
      await this.repondre(phone, MESSAGE_OUVRIR_APP);
      return;
    }
    const membership = memberships[0];

    // Étape 5 — rôle hors ROLES_SAISIE. `as readonly string[]` : ROLES_SAISIE
    // est un sous-ensemble tuple d'OrganizationRole, Array.includes() exige
    // sinon un argument du même type étroit.
    if (!(ROLES_SAISIE as readonly string[]).includes(membership.role)) {
      await this.repondre(phone, MESSAGE_ROLE_INSUFFISANT);
      return;
    }

    // Étape 6 — canal désactivé (défaut OFF, Organization.whatsappOcrEnabled).
    const organization = await this.prisma.organization.findUnique({ where: { id: membership.organizationId } });
    if (!organization || !organization.whatsappOcrEnabled) {
      await this.repondre(phone, MESSAGE_CANAL_DESACTIVE);
      return;
    }

    // Étape 7 — déduplication wamid, AVANT l'anti-abus. Relecture GLOBALE
    // (whatsapp_message_id est @unique GLOBAL, pas composite avec
    // l'organisation) : une redélivraison Meta du MÊME message ne rappelle
    // jamais OcrVisionService, et ne renvoie jamais un second message
    // WhatsApp sortant. ORDRE délibéré : passer APRÈS l'anti-abus ferait
    // consommer deux fois le quota anti-abus (WhatsAppAbuseGuardService) pour
    // une seule et même soumission utilisateur à chaque redélivraison Meta du
    // même wamid — un bug de sécurité, pas qu'une redondance.
    const dejaVu = await this.prisma.ocrDocument.findUnique({ where: { whatsappMessageId: message.id } });
    if (dejaVu) {
      this.logger.log(`Message WhatsApp ${message.id} déjà traité — redélivraison Meta ignorée`);
      return;
    }

    // Étape 8 — anti-abus, par organisation résolue (jamais par IP).
    const autorise = await this.abuseGuard.estAutorise(organization.id);
    if (!autorise) {
      await this.repondre(phone, MESSAGE_PLAFOND);
      return;
    }

    // Étape 9-10 — type de message.
    if (message.type === "text" && message.text?.body) {
      await this.ocrVision.recevoirMessageWhatsapp({
        organizationId: organization.id,
        uploadedByUserId: userPhone.userId,
        whatsappMessageId: message.id,
        customerPhone: phone,
        kind: "text",
        texte: message.text.body,
      });
      return;
    }

    if (message.type === "audio" && message.audio) {
      let media: Awaited<ReturnType<WhatsAppMediaRelay["relayer"]>>;
      try {
        media = await this.mediaRelay.relayer({
          organizationId: organization.id,
          whatsappMessageId: message.id,
          mediaId: message.audio.id,
        });
      } catch (error) {
        if (!(error instanceof WhatsAppMediaRelayIndisponible)) {
          // Pas une panne réseau prévisible : un bug réel, à faire remonter
          // fort plutôt qu'à travestir en message générique à l'utilisateur.
          throw error;
        }
        this.logger.warn(`Relais média WhatsApp indisponible pour le message ${message.id} : ${error.message}`);
        await this.repondre(phone, MESSAGE_RELAIS_INDISPONIBLE);
        return;
      }

      await this.ocrVision.recevoirMessageWhatsapp({
        organizationId: organization.id,
        uploadedByUserId: userPhone.userId,
        whatsappMessageId: message.id,
        customerPhone: phone,
        kind: "audio",
        storageKey: media.storageKey,
        // Le type MIME déclaré par le webhook Meta (message.audio.mime_type),
        // pas celui rendu par les métadonnées du relais : c'est la valeur déjà
        // utilisée par le reste du pipeline (OcrPipelineService.transcribeAndExtract
        // la transmet telle quelle à SttProvider), les deux devant coïncider
        // en pratique.
        mimeType: message.audio.mime_type,
      });
      return;
    }

    // Types de message NON gérés (image, vidéo, document, sticker,
    // localisation, contact) : réponse pédagogique, jamais un crash.
    await this.repondre(phone, MESSAGE_TYPE_NON_SUPPORTE);
  }

  // Best-effort — même garantie que notifierEchecDefinitif() (ocr-pipeline.service.ts) :
  // un échec d'envoi ne remonte jamais. Le corps de la réponse WEBHOOK (200 à
  // Meta) est indépendant de ce message, posé par le contrôleur.
  private async repondre(phone: string, message: string): Promise<void> {
    try {
      await this.whatsapp.send(phone, message);
    } catch (err) {
      this.logger.warn(`Échec d'envoi de la réponse WhatsApp : ${(err as Error).message}`);
    }
  }
}
