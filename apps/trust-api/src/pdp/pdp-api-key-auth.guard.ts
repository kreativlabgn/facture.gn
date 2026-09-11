import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PASSWORD_SERVICE } from "../auth/auth.tokens";
import type { PasswordService } from "../auth/password.service";
import { apiKeySuffixOf } from "../api-keys/api-key-secret";
import { isPdpGatewayAllowed, PDP_GATEWAY_MIN_TIER } from "../common/plan-features-grid";
import { PDP_API_KEY_HEADER } from "./pdp.constants";
import type { PdpClientContext } from "./pdp-client.decorator";

// Message UNIQUE pour tous les échecs d'authentification — en-tête absent, forme
// invalide, clé inconnue, clé révoquée, organisation disparue. Un connecteur ne
// doit jamais pouvoir distinguer « cette clé n'existe pas » de « cette clé est
// révoquée » : la différence transformerait l'endpoint en oracle d'énumération
// des clés en circulation. Même discipline que DevicesService.enroll() et
// AuthService.login().
const CLE_INVALIDE = "Clé API PDP invalide ou révoquée";

// ADR-107 — garde de la passerelle PDP. C'est le SEUL garde réel de ce
// contrôleur : @Public() court-circuite JwtAuthGuard, un éditeur d'ERP n'étant
// pas un utilisateur facture.gn (même posture que PartnerWebhookAuthGuard,
// ADR-082).
//
// RLS (ADR-111) — CARTE DU GARDE. Une seule lecture NON scopée, et elle est
// inévitable : c'est la découverte d'identité elle-même. Tant que la clé n'est
// pas reconnue, aucune organisation n'est connue — il n'y a donc rien à poser
// comme scope (l'œuf et la poule décrit dans rls-rollout.md, étape 1, déjà
// tranché ainsi pour DevicesService.enroll()). Dès que la clé est identifiée,
// TOUT redevient scopé, à commencer par la lecture du palier commercial
// ci-dessous.
@Injectable()
export class PdpApiKeyAuthGuard implements CanActivate {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const presente: unknown = request.headers?.[PDP_API_KEY_HEADER];

    if (typeof presente !== "string") {
      throw new UnauthorizedException(CLE_INVALIDE);
    }

    // Forme vérifiée AVANT toute requête : une chaîne qui n'a pas la forme d'une
    // clé facture.gn ne peut correspondre à aucune ligne, inutile de payer une
    // lecture pour elle. Accessoirement, cela borne le coût d'un flood de
    // chaînes arbitraires sur cet endpoint public.
    const keySuffix = apiKeySuffixOf(presente);
    if (keySuffix === null) {
      throw new UnauthorizedException(CLE_INVALIDE);
    }

    // ── Découverte, hors scope ────────────────────────────────────────────────
    // argon2 est volontairement non réversible : aucun WHERE key_hash = ... n'est
    // possible. On restreint aux clés partageant le suffixe (4 caractères
    // hexadécimaux → 65 536 seaux, donc une poignée de candidates même à
    // l'échelle de toute la plateforme), puis on vérifie une par une.
    // revokedAt: null — une clé révoquée n'est jamais candidate.
    const candidates = await this.prisma.apiKey.findMany({
      where: { keySuffix, revokedAt: null },
      select: { id: true, organizationId: true, keyHash: true },
    });

    let cible: { id: string; organizationId: string } | null = null;
    for (const candidate of candidates) {
      if (await this.passwordService.verify(candidate.keyHash, presente)) {
        cible = { id: candidate.id, organizationId: candidate.organizationId };
        break;
      }
    }
    if (!cible) {
      throw new UnauthorizedException(CLE_INVALIDE);
    }

    // ── À partir d'ici l'organisation est connue : tout est scopé ─────────────
    // findFirst et double clause, jamais findUnique via un client scopé.
    const organization = await organizationScopedClient(this.prisma, cible.organizationId).organization.findFirst({
      where: { id: cible.organizationId },
      select: { commercialTier: true },
    });
    if (!organization) {
      throw new UnauthorizedException(CLE_INVALIDE);
    }

    // 403 EXPLICITE, contrairement aux échecs d'authentification ci-dessus. Ici
    // la clé est valide et l'appelant est bien qui il prétend être : lui cacher
    // la raison du refus ne protège rien et lui ferait perdre des heures à
    // soupçonner ses identifiants. Le palier de son organisation n'est d'ailleurs
    // pas un secret pour elle — c'est son propre contrat.
    if (!isPdpGatewayAllowed(organization.commercialTier)) {
      throw new ForbiddenException(
        `La passerelle PDP est réservée aux paliers ${PDP_GATEWAY_MIN_TIER} et supérieurs — cette organisation est au palier ${organization.commercialTier}`,
      );
    }

    // Exposé au handler via @PdpClient(). C'est la SEULE source d'organisation
    // du chemin PDP : aucun champ organizationId n'existe dans le payload
    // (voir create-pdp-invoice.dto.ts), précisément pour qu'un connecteur ne
    // puisse jamais déposer un document au nom d'une autre PME.
    const client: PdpClientContext = { organizationId: cible.organizationId, apiKeyId: cible.id };
    request.pdpClient = client;

    return true;
  }
}
