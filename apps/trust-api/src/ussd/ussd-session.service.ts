import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { VerificationService } from "../verification/verification.service";
import { PASSWORD_SERVICE } from "../auth/auth.tokens";
import type { PasswordService } from "../auth/password.service";
import { UssdAuthService } from "./ussd-auth.service";
import { UssdInvoiceService } from "./ussd-invoice.service";
import { UssdPaymentService } from "./ussd-payment.service";
import { UssdInvoiceListService } from "./ussd-invoice-list.service";
import { UssdAccountService } from "./ussd-account.service";
import { ClientPortalService } from "../client-portal/client-portal.service";

const SESSION_TTL_MS = 3 * 60_000; // marge au-delà des <90s réels d'une séquence (DAT §Performance)
const PIN_FORMAT = /^\d{4}$/;
const MSISDN_FORMAT = /^\+224\d{8,9}$/;
const AMOUNT_FORMAT = /^[1-9]\d*$/;

// §5 Spec USSD — *620*1*MONTANT# (émission anonyme), *620*2*IDENTIFIANT#
// (vérification directe). Numérotation propre aux raccourcis, distincte du
// menu principal.
const ANONYMOUS_EMISSION_SHORTCUT = /^1\*([1-9]\d*)$/;
const VERIFICATION_SHORTCUT = /^2\*(.+)$/;
// ADR-054 — "facture anonyme plafonnée T0/acte, indépendant du palier" :
// rejet immédiat au-delà, jamais un plafonnement silencieux.
const ANONYMOUS_EMISSION_MAX_GNF = 500_000n;

export interface UssdResponse {
  continue: boolean;
  text: string;
}

interface SessionContext {
  pendingOption?: string;
  authUserId?: string;
  authOrganizationId?: string;
  // Security Audit 2026-08-23, finding #6 — remplace l'ancien pendingPin (stocké en
  // clair) : hash argon2id du PIN candidat, jamais la valeur brute persistée en DB
  // pendant la fenêtre de confirmation.
  pendingPinHash?: string;
  // Security Audit 2026-08-23, finding #4 — message figé de l'issue d'une émission
  // (succès ou rejet), rejoué tel quel par l'état terminal "emit_terminal" en cas
  // de rejeu de la même requête, jamais une seconde émission.
  emitTerminalMessage?: string;
  emitAmountCentimes?: string;
  payInvoiceId?: string;
  payInvoiceNumber?: string;
  mandateAction?: "accept" | "revoke";
  mandateOptions?: { id: string; name: string }[];
}

type UssdSessionRow = {
  id: string;
  state: string;
  phone: string;
  contextData: unknown;
  userId?: string | null;
  organizationId?: string | null;
};

// Quality Audit 2026-08-23, finding #10 — les ~18 états réellement utilisés
// par dispatch()/setState(), jusqu'ici en string libre : une faute de frappe
// dans un appel setState(sessionId, "emit_awaiting_amout", ...) compilait sans
// erreur, l'utilisateur USSD recevait "Session invalide" au tour suivant —
// panne silencieuse sur *620#, canal d'inclusion critique (budget <90s, sans
// retry structuré). UssdSession.state reste `String` côté Prisma (colonne DB
// non typée, jamais un enum) : seule la couche applicative TypeScript se
// durcit ici, pas de migration nécessaire.
type UssdState =
  | "root"
  | "auth_account_code"
  | "auth_pin"
  | "auth_account_pin"
  | "auth_new_pin"
  | "auth_new_pin_confirm"
  | "verify_awaiting_code"
  | "emit_awaiting_amount"
  | "emit_awaiting_customer_phone"
  | "emit_processing"
  | "emit_terminal"
  | "pay_awaiting_invoice_number"
  | "pay_awaiting_confirmation"
  | "manage_account_menu"
  | "account_new_pin"
  | "account_new_pin_confirm"
  | "account_mandate_select"
  | "account_invite_viewer_phone"
  // Quality Audit 2026-08-23, revue post-fix #2 (finding #10) — état "stub
  // générique" pour toute option authentifiée pas encore construite (voir
  // completeAuthentication()) : manquait de l'union d'origine, ces deux
  // écritures passaient par un prisma.ussdSession.update() brut jamais typé
  // contre UssdState, et le switch de dispatch() ci-dessous n'avait aucun case
  // pour ce state, tombant silencieusement sur "Session invalide" en cas de
  // rejeu — exactement la classe de panne silencieuse que ce fix visait à
  // éliminer.
  | "authenticated_stub";

// F13, ADR-096/ADR-108 — "6. Factures reçues" est délibérément distinct de
// "3. Mes factures" : l'option 3 liste les factures ÉMISES par l'organisation
// du collaborateur authentifié (ussdInvoiceList.listRecent, une seule org),
// l'option 6 liste les factures REÇUES par ce numéro en tant que CLIENT, tous
// émetteurs confondus (ClientPortalService.listOrganizations, identité
// client_portal). Même sous-flux d'authentification PIN que les autres
// options (ADR-108 : *620# reste inchangé, aucun OTP côté USSD) — seule la
// question posée à la base diffère.
const ROOT_MENU = [
  "facture.gn *620#",
  "",
  "1. Payer une facture",
  "2. Vérifier un reçu",
  "3. Mes factures",
  "4. Émettre une facture",
  "5. Gérer mon compte",
  "6. Factures reçues",
].join("\n");

// §2.3 Spec USSD — libellés exacts du texte spec.
const STATUS_LABELS: Record<string, string> = {
  paid: "Payée",
  issued: "Non payée",
  partially_paid: "Partiel",
  voided: "Annulée",
};

// §2.5 Spec USSD — 5.1-5.5. Numérotation d'affichage seulement : l'entrée
// attendue reste un chiffre simple (1-5), jamais "5.1" littéral (décision
// utilisateur : chiffres uniquement, aucune lettre). 5.5 (F3, DAT §3.5) ajouté
// après audit F3 — "invitable depuis *620#" existait déjà dans DAT, jamais
// construit ni détaillé au niveau menu jusqu'ici.
const MANAGE_ACCOUNT_MENU = [
  "1. Changer mon PIN",
  "2. Voir mon palier",
  "3. Mandats en attente",
  "4. Mandats actifs",
  "5. Inviter un proche",
].join("\n");

// Toute option autre que 2 (vérifier un reçu, §2.2 — aucune authentification
// requise) exige le sous-flux d'authentification ci-dessous avant sa logique
// propre — construite tâche par tâche par la suite de la feuille de route USSD.
const AUTHENTICATED_OPTIONS = new Set(["1", "3", "4", "5", "6"]);

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
    private readonly ussdAccount: UssdAccountService,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
    private readonly clientPortal: ClientPortalService,
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

    // Cast défensif : UssdSession.state reste `string` côté DB (non typée),
    // mais toute écriture applicative passe désormais par setState()/
    // tryClaimProcessingState() (typés UssdState) — ce cast rend les `case`
    // ci-dessous exhaustivement vérifiés par le compilateur contre UssdState,
    // tout en gardant le `default` comme filet pour une valeur DB inattendue
    // (ancienne session, valeur corrompue).
    switch (session.state as UssdState) {
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
      // Security Audit 2026-08-23, finding #4 — un rejeu (même sessionId) qui
      // arrive pendant une émission déjà en vol, ou après une émission déjà
      // terminée, ne doit JAMAIS redéclencher emitInvoice() : simple replay du
      // résultat déjà connu, aucun accès Prisma supplémentaire.
      case "emit_processing":
        return { continue: false, text: "Traitement en cours, veuillez patienter." };
      case "emit_terminal":
        return { continue: false, text: context.emitTerminalMessage ?? "Cette opération a déjà été traitée." };
      case "pay_awaiting_invoice_number":
        return this.handlePayInvoiceNumber(session, input);
      case "pay_awaiting_confirmation":
        return this.handlePayConfirmation(session, context, input);
      case "manage_account_menu":
        return this.handleManageAccountMenu(session, input);
      case "account_new_pin":
        return this.handleAccountNewPin(session, context, input);
      case "account_new_pin_confirm":
        return this.handleAccountNewPinConfirm(session, context, input);
      case "account_mandate_select":
        return this.handleAccountMandateSelect(session, context, input);
      case "account_invite_viewer_phone":
        return this.handleAccountInviteViewerPhone(session, input);
      // Quality Audit 2026-08-23, revue post-fix #2 (finding #10) — même
      // pattern que emit_terminal ci-dessus : un rejeu (sessionId réutilisé
      // avant expiresAt) sur une option authentifiée pas encore construite
      // reçoit un message terminal propre, jamais "Session invalide".
      case "authenticated_stub":
        return { continue: false, text: "Cette opération a déjà été traitée." };
      default:
        return { continue: false, text: "Session invalide." };
    }
  }

  private async handleRoot(session: UssdSessionRow, input: string): Promise<UssdResponse> {
    if (!input) {
      return { continue: true, text: ROOT_MENU };
    }

    // §5 Spec USSD — numérotation des raccourcis distincte du menu principal
    // (le "1" ici n'est ni l'option 1 ni l'option 4), vérifiée AVANT toute
    // autre branche pour ne jamais être confondue avec un choix de menu.
    const anonymousEmissionMatch = input.match(ANONYMOUS_EMISSION_SHORTCUT);
    if (anonymousEmissionMatch) {
      return this.handleAnonymousEmissionShortcut(session, anonymousEmissionMatch[1]);
    }

    const verificationShortcutMatch = input.match(VERIFICATION_SHORTCUT);
    if (verificationShortcutMatch) {
      return this.handleVerifyReceipt(verificationShortcutMatch[1]);
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

  // §5 Spec USSD — même sous-flux d'authentification que les options
  // normales (3.1 téléphone reconnu / 3.2 code compte), montant déjà connu
  // donc stocké dès maintenant dans le contexte (aucune collecte ultérieure,
  // "anonyme" exclut tout client identifié — jamais de resolveOrCreateCustomer).
  private async handleAnonymousEmissionShortcut(session: UssdSessionRow, amountGnf: string): Promise<UssdResponse> {
    const amount = BigInt(amountGnf);
    if (amount > ANONYMOUS_EMISSION_MAX_GNF) {
      return { continue: false, text: "Une facture anonyme est plafonnée à 500 000 GNF (ADR-054)." };
    }

    const emitAmountCentimes = (amount * 100n).toString();
    const identity = await this.ussdAuth.resolveByPhone(session.phone);
    if (!identity) {
      await this.setState(session.id, "auth_account_code", { pendingOption: "anon_emit", emitAmountCentimes });
      return { continue: true, text: "Numéro non reconnu. Entrez votre code compte :" };
    }

    return this.startPinFlow(
      session.id,
      "auth_pin",
      { pendingOption: "anon_emit", authUserId: identity.userId, emitAmountCentimes },
      identity.hasPin,
    );
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

    // F13, revue post-fix #2 — PIN vérifié = possession du numéro prouvée,
    // même garantie qu'un OTP (ADR-108). Sans ça, ClientPortalService (option
    // 6, "Factures reçues") ne verrait jamais un utilisateur authentifié
    // uniquement par *620#.
    await this.ussdAuth.confirmPhoneOwnership(session.phone);

    return this.completeAuthentication(session.id, context, session.state);
  }

  // Security Audit 2026-08-23, finding #6 — le PIN candidat est haché (argon2id,
  // même service que UssdAuthService/PasswordService) AVANT d'être persisté dans
  // contextData : jamais le PIN en clair en base, même pendant la fenêtre de
  // confirmation à l'étape suivante (aucune purge de UssdSession n'existe dans ce
  // repo — une ligne abandonnée avant confirmation resterait sinon lisible en clair
  // indéfiniment via un dump/backup/replica).
  private async handleNewPin(session: UssdSessionRow, context: SessionContext, input: string): Promise<UssdResponse> {
    if (!PIN_FORMAT.test(input)) {
      return { continue: true, text: "PIN invalide — 4 chiffres attendus. Réessayez :" };
    }
    const pendingPinHash = await this.passwordService.hash(input);
    await this.setState(session.id, "auth_new_pin_confirm", { ...context, pendingPinHash });
    return { continue: true, text: "Confirmez votre PIN :" };
  }

  private async handleNewPinConfirm(
    session: UssdSessionRow,
    context: SessionContext,
    input: string,
  ): Promise<UssdResponse> {
    const matches = context.pendingPinHash ? await this.passwordService.verify(context.pendingPinHash, input) : false;
    if (!matches) {
      return { continue: false, text: "Les PIN saisis ne correspondent pas. Recommencez depuis *620#." };
    }

    await this.ussdAuth.createPin(context.authUserId as string, input);
    return this.completeAuthentication(session.id, context, session.state);
  }

  private async completeAuthentication(
    sessionId: string,
    context: SessionContext,
    currentState: string,
  ): Promise<UssdResponse> {
    // §5 Spec USSD — raccourci d'émission anonyme : montant déjà connu
    // (stocké dès handleAnonymousEmissionShortcut), jamais de collecte de
    // téléphone client (anonyme), jamais de resolveOrCreateCustomer.
    if (context.pendingOption === "anon_emit") {
      const organizationId = await this.ussdInvoice.resolveOrganizationForEmission(
        context.authUserId as string,
        context.authOrganizationId,
      );
      if (!organizationId) {
        return { continue: false, text: "Aucune organisation habilitée à émettre n'a été trouvée pour ce compte." };
      }

      // Security Audit 2026-08-23, finding #4 (durci en revue post-fix #2) —
      // transition ATOMIQUE (where:{state: currentState}) vers un état
      // intermédiaire AVANT l'appel emitInvoice() : un rejeu USSD réellement
      // concurrent (timeout réseau agrégateur) ne peut plus gagner la ligne deux
      // fois, voir tryClaimProcessingState() pour le détail de la garde.
      // currentState provient de session.state (string, colonne DB non typée) —
      // même cast défensif que dispatch(), voir la note UssdState plus haut.
      const claimed = await this.tryClaimProcessingState(sessionId, currentState as UssdState, context);
      if (!claimed) {
        return { continue: false, text: "Traitement en cours, veuillez patienter." };
      }

      const amountCentimes = BigInt(context.emitAmountCentimes as string);
      try {
        const invoice = await this.ussdInvoice.emitInvoice(organizationId, amountCentimes, undefined);
        const message = `Facture ${invoice.number} émise.`;
        await this.setState(sessionId, "emit_terminal", { emitTerminalMessage: message });
        return { continue: false, text: message };
      } catch (error) {
        if (error instanceof ForbiddenException) {
          await this.setState(sessionId, "emit_terminal", { emitTerminalMessage: error.message });
          return { continue: false, text: error.message };
        }
        throw error;
      }
    }

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
          // Quality Audit 2026-08-23, revue post-fix #2 (finding #10) — le
          // littéral ci-dessous est désormais vérifié contre UssdState via ce
          // type explicite (Prisma.InputJsonValue/String côté colonne DB
          // n'aurait rien signalé sur une faute de frappe sans ça).
          state: "authenticated_stub" satisfies UssdState,
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

    if (context.pendingOption === "5") {
      // Security Audit 2026-08-23, finding #7 — même re-résolution que les options
      // 1/3/4 ci-dessous : context.authOrganizationId reste undefined pour le
      // chemin d'authentification le plus courant (téléphone déjà reconnu,
      // UssdAuthService.resolveByPhone() ne le renvoie jamais), donc jamais fait
      // confiance seul pour peupler session.organizationId — sinon tout le menu
      // "Gérer mon compte" (PIN, mandats, invitation) hériterait d'une organisation
      // non résolue.
      const organizationId = await this.ussdInvoice.resolveOrganizationForEmission(
        context.authUserId as string,
        context.authOrganizationId,
      );
      if (!organizationId) {
        return { continue: false, text: "Aucune organisation habilitée trouvée pour ce compte." };
      }
      await this.prisma.ussdSession.update({
        where: { id: sessionId },
        data: {
          state: "manage_account_menu",
          userId: context.authUserId,
          organizationId,
          contextData: {},
        },
      });
      return { continue: true, text: MANAGE_ACCOUNT_MENU };
    }

    // F13, ADR-096/ADR-108 — identité client_portal déjà résolue par le même
    // sous-flux PIN que les autres options (authUserId), aucune organisation à
    // résoudre ici (contrairement à 1/3/4/5) : ClientPortalService.listOrganizations
    // traverse TOUTES les organisations où ce numéro correspond à un Customer.phone.
    if (context.pendingOption === "6") {
      await this.prisma.ussdSession.update({
        where: { id: sessionId },
        data: {
          state: "authenticated_stub" satisfies UssdState,
          userId: context.authUserId,
          organizationId: context.authOrganizationId,
          contextData: {},
        },
      });
      return this.renderReceivedInvoices(context.authUserId as string);
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
        // Quality Audit 2026-08-23, revue post-fix #2 (finding #10) — voir
        // commentaire jumeau plus haut dans ce fichier (pendingOption==="3").
        state: "authenticated_stub" satisfies UssdState,
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

    // Security Audit 2026-08-23, finding #4 (durci en revue post-fix #2) — même
    // garde ATOMIQUE que la branche anon_emit de completeAuthentication()
    // ci-dessus : where:{state: "emit_awaiting_customer_phone"} garantit qu'une
    // seule requête concurrente peut gagner la transition, jamais les deux.
    const claimed = await this.tryClaimProcessingState(session.id, "emit_awaiting_customer_phone", context);
    if (!claimed) {
      return { continue: false, text: "Traitement en cours, veuillez patienter." };
    }

    // D4 — VelocityTierService.assertWithinLimits() (appelé par emitInvoice,
    // avant toute création) lève ForbiddenException au-delà des plafonds T0-T3.
    let invoice;
    try {
      invoice = await this.ussdInvoice.emitInvoice(organizationId, amountCentimes, customerId);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.setState(session.id, "emit_terminal", { emitTerminalMessage: error.message });
        return { continue: false, text: error.message };
      }
      throw error;
    }

    // C9 (déjà câblée dans InvoicesService.issue()) n'envoie que si customerId
    // est renseigné — le message reflète fidèlement ce qui a réellement eu lieu.
    const smsNote = customerId ? " Lien de paiement envoyé par SMS." : "";
    const message = `Facture ${invoice.number} émise.${smsNote}`;
    await this.setState(session.id, "emit_terminal", { emitTerminalMessage: message });
    return { continue: false, text: message };
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

  // F13, ADR-096/ADR-108 — résumé un seul écran (un organisme par ligne, solde
  // dû), pas de drill-down facture par facture sur ce canal : la fenêtre <90s
  // et l'absence de pagination fiable sur USSD réservent le détail complet à la
  // PWA (GET /client-portal/customers/:customerId/invoices). runningBalance à
  // 0 affiché explicitement ("Aucun solde dû") plutôt qu'omis — un organisme où
  // ce client existe mais n'a rien à payer reste une information utile.
  private async renderReceivedInvoices(userId: string): Promise<UssdResponse> {
    const organizations = await this.clientPortal.listOrganizations(userId);
    if (organizations.length === 0) {
      return { continue: false, text: "Aucune facture reçue pour le moment." };
    }

    const lines = organizations.map((org) => {
      const balance = org.runningBalance > 0n ? formatGnfPlainText(org.runningBalance.toString()) : "Aucun solde dû";
      return `${org.organizationName} — ${balance}`;
    });
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

  // §2.5 Spec USSD — choix 1-4 (jamais "5.1" littéral, décision utilisateur :
  // chiffres uniquement).
  private async handleManageAccountMenu(session: UssdSessionRow, input: string): Promise<UssdResponse> {
    if (input === "1") {
      await this.setState(session.id, "account_new_pin", {});
      return { continue: true, text: "Nouveau PIN (4 chiffres) :" };
    }

    if (input === "2") {
      const tier = await this.ussdAccount.getTierSummary(session.organizationId as string);
      return { continue: false, text: `Votre palier actuel : ${tier}` };
    }

    if (input === "3") {
      return this.presentMandateSelection(session, "accept", "Aucun mandat en attente.");
    }

    if (input === "4") {
      return this.presentMandateSelection(session, "revoke", "Aucun mandat actif.");
    }

    if (input === "5") {
      await this.setState(session.id, "account_invite_viewer_phone", {});
      return { continue: true, text: "Numéro du proche à inviter :" };
    }

    return { continue: false, text: "Choix invalide." };
  }

  // 5.5, F3, DAT §3.5 — délègue entièrement la vérification du rôle du
  // demandeur (owner/admin) et l'invitation elle-même à
  // UssdAccountService.inviteViewer() (même mécanisme que la PWA,
  // OrganizationsService.inviteMember()). Ajout immédiat, aucun flux
  // d'acceptation — même précédent que F14/F8.
  private async handleAccountInviteViewerPhone(session: UssdSessionRow, input: string): Promise<UssdResponse> {
    const phone = input.trim();
    if (!MSISDN_FORMAT.test(phone)) {
      return { continue: true, text: "Numéro invalide. Réessayez :" };
    }

    try {
      await this.ussdAccount.inviteViewer(session.organizationId as string, session.userId as string, phone);
      return { continue: false, text: `${phone} peut désormais consulter vos factures.` };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ConflictException) {
        return { continue: false, text: error.message };
      }
      throw error;
    }
  }

  // 5.3/5.4 partagent la même mécanique de sélection numérotée — seule la
  // source de la liste (pending vs active) et l'action finale diffèrent.
  private async presentMandateSelection(
    session: UssdSessionRow,
    action: "accept" | "revoke",
    emptyMessage: string,
  ): Promise<UssdResponse> {
    const organizationId = session.organizationId as string;
    const mandates =
      action === "accept"
        ? await this.ussdAccount.listPendingMandates(organizationId)
        : await this.ussdAccount.listActiveMandates(organizationId);

    if (mandates.length === 0) {
      return { continue: false, text: emptyMessage };
    }

    const options = mandates.map((mandate: { id: string; practice: { name: string } }) => ({
      id: mandate.id,
      name: mandate.practice.name,
    }));
    await this.setState(session.id, "account_mandate_select", { mandateAction: action, mandateOptions: options });

    const lines = options.map((option, index) => `${index + 1}. ${option.name}`);
    return { continue: true, text: [...lines, "Choisissez un numéro :"].join("\n") };
  }

  private async handleAccountMandateSelect(
    session: UssdSessionRow,
    context: SessionContext,
    input: string,
  ): Promise<UssdResponse> {
    const options = context.mandateOptions ?? [];
    const index = Number(input) - 1;
    const selected = Number.isInteger(index) ? options[index] : undefined;
    if (!selected) {
      return { continue: false, text: "Numéro invalide." };
    }

    const organizationId = session.organizationId as string;
    const userId = session.userId as string;
    if (context.mandateAction === "accept") {
      await this.ussdAccount.acceptMandate(organizationId, selected.id, userId);
      return { continue: false, text: `Mandat de ${selected.name} accepté.` };
    }

    await this.ussdAccount.revokeMandate(organizationId, selected.id, userId);
    return { continue: false, text: `Mandat de ${selected.name} révoqué.` };
  }

  // Security Audit 2026-08-23, finding #6 — même durcissement que handleNewPin() ci-dessus.
  private async handleAccountNewPin(session: UssdSessionRow, context: SessionContext, input: string): Promise<UssdResponse> {
    if (!PIN_FORMAT.test(input)) {
      return { continue: true, text: "PIN invalide — 4 chiffres attendus. Réessayez :" };
    }
    const pendingPinHash = await this.passwordService.hash(input);
    await this.setState(session.id, "account_new_pin_confirm", { ...context, pendingPinHash });
    return { continue: true, text: "Confirmez le nouveau PIN :" };
  }

  // §3.3 Spec USSD — "reset PIN déclenche une bascule 24-48h vers T0 + SMS
  // systématique", déjà géré par UssdAccountService.changePin().
  private async handleAccountNewPinConfirm(
    session: UssdSessionRow,
    context: SessionContext,
    input: string,
  ): Promise<UssdResponse> {
    const matches = context.pendingPinHash ? await this.passwordService.verify(context.pendingPinHash, input) : false;
    if (!matches) {
      return { continue: false, text: "Les PIN saisis ne correspondent pas. Recommencez depuis le menu Gérer mon compte." };
    }

    await this.ussdAccount.changePin(session.userId as string, session.organizationId as string, input);
    return { continue: false, text: "PIN changé. Un SMS de confirmation vous a été envoyé." };
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

  private async setState(sessionId: string, state: UssdState, context: SessionContext): Promise<void> {
    await this.prisma.ussdSession.update({
      where: { id: sessionId },
      data: { state, contextData: context as Prisma.InputJsonValue },
    });
  }

  // Security Audit 2026-08-23, revue post-fix #2 (finding #4) — setState() seul
  // est un update() INCONDITIONNEL : deux requêtes réellement concurrentes pour le
  // même sessionId (le vrai scénario de rejeu réseau agrégateur, pas seulement un
  // rejeu séquentiel après commit) liraient toutes deux le même état initial avant
  // qu'aucune n'ait écrit "emit_processing", et passeraient donc TOUTES LES DEUX
  // jusqu'à emitInvoice() — double émission. Le where:{state: expectedState} rend
  // la transition atomique au niveau DB : une seule des deux requêtes concurrentes
  // peut gagner la ligne (count===1), l'autre voit count===0 et n'appelle jamais
  // emitInvoice().
  private async tryClaimProcessingState(
    sessionId: string,
    expectedState: UssdState,
    context: SessionContext,
  ): Promise<boolean> {
    const claimed = await this.prisma.ussdSession.updateMany({
      where: { id: sessionId, state: expectedState },
      data: { state: "emit_processing", contextData: context as Prisma.InputJsonValue },
    });
    return claimed.count === 1;
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
