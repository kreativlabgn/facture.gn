import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { VerificationService } from "../verification/verification.service";
import { UssdAuthService } from "./ussd-auth.service";

const SESSION_TTL_MS = 3 * 60_000; // marge au-delà des <90s réels d'une séquence (DAT §Performance)
const PIN_FORMAT = /^\d{4}$/;

export interface UssdResponse {
  continue: boolean;
  text: string;
}

interface SessionContext {
  pendingOption?: string;
  authUserId?: string;
  authOrganizationId?: string;
  pendingPin?: string;
}

type UssdSessionRow = {
  id: string;
  state: string;
  phone: string;
  contextData: unknown;
};

const ROOT_MENU = [
  "facture.gn *620#",
  "",
  "1. Payer une facture",
  "2. Vérifier un reçu",
  "3. Mes factures",
  "4. Émettre une facture",
  "5. Gérer mon compte",
].join("\n");

// Toute option autre que 2 (vérifier un reçu, §2.2 — aucune authentification
// requise) exige le sous-flux d'authentification ci-dessous avant sa logique
// propre — construite tâche par tâche par la suite de la feuille de route USSD.
const AUTHENTICATED_OPTIONS = new Set(["1", "3", "4", "5"]);

// §1 Spec USSD — menu canonique, point d'entrée unique. Machine à états pilotée
// par UssdSession.state (même style que la "machine à états" déjà pratiquée dans
// InvoicesService) — chaque tâche suivante de la feuille de route USSD remplace
// une branche du dispatch par sa vraie logique métier (cette tâche construit
// uniquement le sous-flux d'authentification, D2).
@Injectable()
export class UssdSessionService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly ussdAuth: UssdAuthService,
    private readonly verification: VerificationService,
  ) {}

  async handleRequest(sessionId: string, phone: string, input: string): Promise<UssdResponse> {
    const session = await this.loadOrCreateSession(sessionId, phone);
    return this.dispatch(session, input);
  }

  private async loadOrCreateSession(sessionId: string, phone: string): Promise<UssdSessionRow> {
    const existing = await this.prisma.ussdSession.findUnique({ where: { sessionId } });
    // Une session expirée est traitée comme neuve, jamais une erreur — un
    // agrégateur réutilise parfois un sessionId après un timeout réseau.
    if (existing && existing.expiresAt > new Date()) {
      return existing;
    }

    return this.prisma.ussdSession.create({
      data: {
        sessionId,
        phone,
        state: "root",
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  private async dispatch(session: UssdSessionRow, input: string): Promise<UssdResponse> {
    const context = (session.contextData as SessionContext | null) ?? {};

    switch (session.state) {
      case "root":
        return this.handleRoot(session, input);
      case "auth_account_code":
        return this.handleAccountCode(session, context, input);
      case "auth_pin":
      case "auth_account_pin":
        return this.handlePinEntry(session, context, input);
      case "auth_new_pin":
        return this.handleNewPin(session, context, input);
      case "auth_new_pin_confirm":
        return this.handleNewPinConfirm(session, context, input);
      case "verify_awaiting_code":
        return this.handleVerifyReceipt(input);
      default:
        return { continue: false, text: "Session invalide." };
    }
  }

  private async handleRoot(session: UssdSessionRow, input: string): Promise<UssdResponse> {
    if (!input) {
      return { continue: true, text: ROOT_MENU };
    }

    if (input === "2") {
      await this.setState(session.id, "verify_awaiting_code", {});
      return { continue: true, text: "Entrez l'identifiant de vérification :" };
    }

    if (!AUTHENTICATED_OPTIONS.has(input)) {
      return { continue: false, text: "Fonctionnalité bientôt disponible." };
    }

    const identity = await this.ussdAuth.resolveByPhone(session.phone);
    if (!identity) {
      await this.setState(session.id, "auth_account_code", { pendingOption: input });
      return { continue: true, text: "Numéro non reconnu. Entrez votre code compte :" };
    }

    return this.startPinFlow(session.id, "auth_pin", { pendingOption: input, authUserId: identity.userId }, identity.hasPin);
  }

  private async handleAccountCode(
    session: UssdSessionRow,
    context: SessionContext,
    input: string,
  ): Promise<UssdResponse> {
    const identity = await this.ussdAuth.resolveByAccountCode(input);
    if (!identity) {
      return { continue: false, text: "Code compte invalide." };
    }

    return this.startPinFlow(
      session.id,
      "auth_account_pin",
      { pendingOption: context.pendingOption, authUserId: identity.userId, authOrganizationId: identity.organizationId },
      identity.hasPin,
    );
  }

  // hasPin=false → premier accès *620# de cet utilisateur (décision utilisateur,
  // création du PIN depuis l'USSD lui-même, jamais depuis la PWA).
  private async startPinFlow(
    sessionId: string,
    pinState: "auth_pin" | "auth_account_pin",
    context: SessionContext,
    hasPin: boolean,
  ): Promise<UssdResponse> {
    if (!hasPin) {
      await this.setState(sessionId, "auth_new_pin", context);
      return { continue: true, text: "Vous n'avez pas encore de PIN. Créez un PIN à 4 chiffres :" };
    }
    await this.setState(sessionId, pinState, context);
    return { continue: true, text: "Entrez votre PIN :" };
  }

  private async handlePinEntry(session: UssdSessionRow, context: SessionContext, input: string): Promise<UssdResponse> {
    const userId = context.authUserId as string;
    const result = await this.ussdAuth.verifyPin(userId, input);

    if (result.locked) {
      return { continue: false, text: "PIN bloqué — réessayez dans 30 minutes." };
    }
    if (!result.success) {
      return { continue: true, text: "PIN incorrect. Réessayez :" };
    }

    return this.completeAuthentication(session.id, context);
  }

  private async handleNewPin(session: UssdSessionRow, context: SessionContext, input: string): Promise<UssdResponse> {
    if (!PIN_FORMAT.test(input)) {
      return { continue: true, text: "PIN invalide — 4 chiffres attendus. Réessayez :" };
    }
    await this.setState(session.id, "auth_new_pin_confirm", { ...context, pendingPin: input });
    return { continue: true, text: "Confirmez votre PIN :" };
  }

  private async handleNewPinConfirm(
    session: UssdSessionRow,
    context: SessionContext,
    input: string,
  ): Promise<UssdResponse> {
    if (input !== context.pendingPin) {
      return { continue: false, text: "Les PIN saisis ne correspondent pas. Recommencez depuis *620#." };
    }

    await this.ussdAuth.createPin(context.authUserId as string, input);
    return this.completeAuthentication(session.id, context);
  }

  private async completeAuthentication(sessionId: string, context: SessionContext): Promise<UssdResponse> {
    await this.prisma.ussdSession.update({
      where: { id: sessionId },
      data: {
        state: "authenticated_stub",
        userId: context.authUserId,
        organizationId: context.authOrganizationId,
        contextData: {},
      },
    });
    // Option réellement câblée par les tâches suivantes de la feuille de route
    // USSD (ussd-menu-emit-invoice, ussd-menu-pay-invoice, ...).
    return { continue: false, text: `Authentification réussie. Option ${context.pendingOption} bientôt disponible.` };
  }

  // §2.2 Spec USSD — aucune authentification requise, statut de contestation
  // affiché uniquement si ≠ none. Réutilise VerificationService tel quel
  // (déjà utilisé par GET /verify/:certificationId, page publique PWA) — seul
  // l'habillage texte change.
  private async handleVerifyReceipt(certificationId: string): Promise<UssdResponse> {
    try {
      const invoice = await this.verification.verifyByCertificationId(certificationId);
      const lines = [
        `Facture ${invoice.number}`,
        `Montant : ${formatGnfPlainText(invoice.totalTtc)}`,
        `Statut : ${invoice.status}`,
      ];
      if (invoice.disputeStatus !== "none") {
        lines.push(`Contestation : ${invoice.disputeStatus}`);
      }
      return { continue: false, text: lines.join("\n") };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { continue: false, text: "Aucune facture ne correspond à cet identifiant." };
      }
      throw error;
    }
  }

  private async setState(sessionId: string, state: string, context: SessionContext): Promise<void> {
    await this.prisma.ussdSession.update({
      where: { id: sessionId },
      data: { state, contextData: context as Prisma.InputJsonValue },
    });
  }
}

// Pas d'Intl.NumberFormat (pas de garantie de locale complète en environnement
// Node minimal) — mêmes centimes GNF que formatGnf côté web, sérialisation
// texte manuelle adaptée à un canal contraint.
function formatGnfPlainText(centimesString: string): string {
  const centimes = BigInt(centimesString);
  const gnf = centimes / 100n;
  const withThousands = gnf.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${withThousands} GNF`;
}
