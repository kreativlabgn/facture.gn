import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

const SESSION_TTL_MS = 3 * 60_000; // marge au-delà des <90s réels d'une séquence (DAT §Performance)

export interface UssdResponse {
  continue: boolean;
  text: string;
}

const ROOT_MENU = [
  "facture.gn *620#",
  "",
  "1. Payer une facture",
  "2. Vérifier un reçu",
  "3. Mes factures",
  "4. Émettre une facture",
  "5. Gérer mon compte",
].join("\n");

// §1 Spec USSD — menu canonique, point d'entrée unique. Machine à états pilotée
// par UssdSession.state (même style que la "machine à états" déjà pratiquée dans
// InvoicesService) — chaque tâche suivante de la feuille de route USSD remplace
// une branche du dispatch ci-dessous par sa vraie logique.
@Injectable()
export class UssdSessionService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async handleRequest(sessionId: string, phone: string, input: string): Promise<UssdResponse> {
    const session = await this.loadOrCreateSession(sessionId, phone);
    return this.dispatch(session, input);
  }

  private async loadOrCreateSession(sessionId: string, phone: string) {
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

  private dispatch(session: { state: string }, input: string): UssdResponse {
    if (session.state === "root") {
      if (!input) {
        return { continue: true, text: ROOT_MENU };
      }
      // Choix 1-5 : branches remplacées une par une par les tâches suivantes
      // (ussd-menu-verify-receipt, ussd-menu-emit-invoice, ussd-pin-auth, ...).
      return { continue: false, text: "Fonctionnalité bientôt disponible." };
    }

    return { continue: false, text: "Session invalide." };
  }
}
