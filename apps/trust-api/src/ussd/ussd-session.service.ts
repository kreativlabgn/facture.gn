import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { VerificationService } from "../verification/verification.service";
import { UssdAuthService } from "./ussd-auth.service";
import { UssdInvoiceService } from "./ussd-invoice.service";
import { UssdPaymentService } from "./ussd-payment.service";
import { UssdInvoiceListService } from "./ussd-invoice-list.service";

const SESSION_TTL_MS = 3 * 60_000; // marge au-delà des <90s réels d'une séquence (DAT §Performance)
const PIN_FORMAT = /^\d{4}$/;
const MSISDN_FORMAT = /^\+224\d{8,9}$/;
const AMOUNT_FORMAT = /^[1-9]\d*$/;

export interface UssdResponse {
  continue: boolean;
  text: string;
}

interface SessionContext {
  pendingOption?: string;
  authUserId?: string;
  authOrganizationId?: string;
  pendingPin?: string;
  emitAmountCentimes?: string;
  payInvoiceId?: string;
  payInvoiceNumber?: string;
}

type UssdSessionRow = {
  id: string;
  state: string;
  phone: string;
  contextData: unknown;
  userId?: string | null;
  organizationId?: string | null;
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

// §2.3 Spec USSD — libellés exacts du texte spec.
const STATUS_LABELS: Record<string, string> = {
  paid: "Payée",
  issued: "Non payée",
  partially_paid: "Partiel",
  voided: "Annulée",
};

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
    private readonly ussdInvoice: UssdInvoiceService,
    private readonly ussdPayment: UssdPaymentService,
    private readonly ussdInvoiceList: UssdInvoiceListService,
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
      case "emit_awaiting_amount":
        return this.handleEmitAmount(session, input);
      case "emit_awaiting_customer_phone":
        return this.handleEmitCustomerPhone(session, context, input);
      case "pay_awaiting_invoice_number":
        return this.handlePayInvoiceNumber(session, input);
      case "pay_awaiting_confirmation":
        return this.handlePayConfirmation(session, context, input);
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
    // Options 1 (payer, D3) et 4 (émettre, D1) câblées ici — 3/5 restent le
    // stub générique, remplacé tâche par tâche par la suite de la feuille de
    // route USSD.
    if (context.pendingOption === "4") {
      await this.prisma.ussdSession.update({
        where: { id: sessionId },
        data: {
          state: "emit_awaiting_amount",
          userId: context.authUserId,
          organizationId: context.authOrganizationId,
          contextData: {},
        },
      });
      return { continue: true, text: "Montant de la facture (GNF) :" };
    }

    if (context.pendingOption === "3") {
      await this.prisma.ussdSession.update({
        where: { id: sessionId },
        data: {
          state: "authenticated_stub",
          userId: context.authUserId,
          organizationId: context.authOrganizationId,
          contextData: {},
        },
      });
      const organizationId = await this.ussdInvoice.resolveOrganizationForEmission(
        context.authUserId as string,
        context.authOrganizationId,
      );
      if (!organizationId) {
        return { continue: false, text: "Aucune organisation habilitée trouvée pour ce compte." };
      }
      return this.renderMyInvoices(organizationId);
    }

    if (context.pendingOption === "1") {
      await this.prisma.ussdSession.update({
        where: { id: sessionId },
        data: {
          state: "pay_awaiting_invoice_number",
          userId: context.authUserId,
          organizationId: context.authOrganizationId,
          contextData: {},
        },
      });
      return { continue: true, text: "Numéro de facture :" };
    }

    await this.prisma.ussdSession.update({
      where: { id: sessionId },
      data: {
        state: "authenticated_stub",
        userId: context.authUserId,
        organizationId: context.authOrganizationId,
        contextData: {},
      },
    });
    return { continue: false, text: `Authentification réussie. Option ${context.pendingOption} bientôt disponible.` };
  }

  // §2.4 Spec USSD — montant seul collecté, jamais une description (séquence
  // < 90s). AMOUNT_FORMAT rejette "0" et tout préfixe zéro ambigu.
  private async handleEmitAmount(session: UssdSessionRow, input: string): Promise<UssdResponse> {
    if (!AMOUNT_FORMAT.test(input)) {
      return { continue: true, text: "Montant invalide. Réessayez :" };
    }
    // Centimes GNF (convention repo) — la saisie utilisateur est en GNF naturels.
    const amountCentimes = (BigInt(input) * 100n).toString();
    await this.setState(session.id, "emit_awaiting_customer_phone", { emitAmountCentimes: amountCentimes });
    return { continue: true, text: "Numéro du client (laisser vide si aucun) :" };
  }

  private async handleEmitCustomerPhone(
    session: UssdSessionRow,
    context: SessionContext,
    input: string,
  ): Promise<UssdResponse> {
    const phone = input.trim();
    if (phone && !MSISDN_FORMAT.test(phone)) {
      return { continue: true, text: "Numéro invalide. Réessayez :" };
    }

    const organizationId = await this.ussdInvoice.resolveOrganizationForEmission(
      session.userId as string,
      session.organizationId ?? undefined,
    );
    if (!organizationId) {
      return { continue: false, text: "Aucune organisation habilitée à émettre n'a été trouvée pour ce compte." };
    }

    const customerId = await this.ussdInvoice.resolveOrCreateCustomer(organizationId, phone || undefined);
    const amountCentimes = BigInt(context.emitAmountCentimes as string);

    // D4 — VelocityTierService.assertWithinLimits() (appelé par emitInvoice,
    // avant toute création) lève ForbiddenException au-delà des plafonds T0-T3.
    let invoice;
    try {
      invoice = await this.ussdInvoice.emitInvoice(organizationId, amountCentimes, customerId);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return { continue: false, text: error.message };
      }
      throw error;
    }

    // C9 (déjà câblée dans InvoicesService.issue()) n'envoie que si customerId
    // est renseigné — le message reflète fidèlement ce qui a réellement eu lieu.
    const smsNote = customerId ? " Lien de paiement envoyé par SMS." : "";
    return { continue: false, text: `Facture ${invoice.number} émise.${smsNote}` };
  }

  // §2.3 Spec USSD — labels français exacts du texte spec, jamais le nom de
  // statut technique brut affiché au marchand.
  private async renderMyInvoices(organizationId: string): Promise<UssdResponse> {
    const invoices = await this.ussdInvoiceList.listRecent(organizationId);
    if (invoices.length === 0) {
      return { continue: false, text: "Aucune facture pour le moment." };
    }

    const lines = invoices.map(
      (invoice) => `${invoice.number} — ${STATUS_LABELS[invoice.status] ?? invoice.status} — ${formatGnfPlainText(invoice.totalTtc.toString())}`,
    );
    return { continue: false, text: lines.join("\n") };
  }

  // D3, §2.1 Spec USSD — amount_due (jamais totalTtc, C11) + frais affichés
  // séparément AVANT confirmation.
  private async handlePayInvoiceNumber(session: UssdSessionRow, input: string): Promise<UssdResponse> {
    const organizationId = await this.ussdInvoice.resolveOrganizationForEmission(
      session.userId as string,
      session.organizationId ?? undefined,
    );
    if (!organizationId) {
      return { continue: false, text: "Aucune organisation habilitée trouvée pour ce compte." };
    }

    const invoice = await this.ussdPayment.findPayableInvoice(organizationId, input);
    if (!invoice) {
      return { continue: false, text: "Aucune facture payable ne correspond à ce numéro." };
    }

    const fee = await this.ussdPayment.previewFee(organizationId, invoice.amountDue);
    const total = invoice.amountDue + fee;
    await this.setState(session.id, "pay_awaiting_confirmation", {
      payInvoiceId: invoice.id,
      payInvoiceNumber: invoice.number as string,
    });

    return {
      continue: true,
      text: [
        `Facture ${invoice.number}`,
        `Montant dû : ${formatGnfPlainText(invoice.amountDue.toString())}`,
        `Frais : ${formatGnfPlainText(fee.toString())}`,
        `Total : ${formatGnfPlainText(total.toString())}`,
        "Confirmer ? (1 = Oui)",
      ].join("\n"),
    };
  }

  private async handlePayConfirmation(
    session: UssdSessionRow,
    context: SessionContext,
    input: string,
  ): Promise<UssdResponse> {
    if (input !== "1") {
      return { continue: false, text: "Paiement annulé." };
    }

    await this.ussdPayment.confirmPayment(context.payInvoiceId as string, session.userId as string);
    return { continue: false, text: `Lien de paiement envoyé pour la facture ${context.payInvoiceNumber}.` };
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
