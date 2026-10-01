import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

const FLASH_WINDOW_MS = 30 * 60_000; // §Décision d'architecture 1 — fenêtre d'éligibilité, borne aussi l'anti-répétition
const FLASH_ELIGIBLE_STATUSES = ["issued", "partially_paid"] as const;

// *620#, capacité 1 (interception flash suggestive) — post-authentification
// PIN, propose au CLIENT (pas au marchand) la facture qui lui est destinée,
// émise il y a moins de 30 min.
//
// RLS (ADR-111 étape 1) — findCandidate() RESTE NON SCOPÉ, À DESSEIN. Même
// statut que ClientPortalService.listOrganizations() (F13) et
// UssdAuthService : c'est le CLIENT qui s'authentifie, pas le marchand — un
// même numéro peut être client de N'IMPORTE QUELLE organisation de la
// plateforme, jamais une seule. markSuggested(), lui, écrit sur UNE facture
// déjà identifiée : scopé à son organisation, comme tout le reste du module.
@Injectable()
export class UssdFlashSuggestionService {
  private readonly logger = new Logger(UssdFlashSuggestionService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findCandidate(phone: string) {
    return this.prisma.invoice.findFirst({
      where: {
        customer: { phone },
        documentType: "invoice",
        status: { in: [...FLASH_ELIGIBLE_STATUSES] },
        issuedAt: { gte: new Date(Date.now() - FLASH_WINDOW_MS) },
        flashSuggestedAt: null,
      },
      orderBy: { issuedAt: "desc" },
      select: { id: true, organizationId: true, number: true, amountDue: true },
    });
  }

  // Best-effort, jamais bloquant (même précédent que
  // PaymentsService.detectAndRecordCashAnomaly()/regenerateLinkForRemainingBalance()) :
  // rater le marquage ne doit jamais empêcher le client de voir/payer sa
  // facture — au pire, elle sera re-suggérée une fois de plus dans la fenêtre
  // de 30 min. updateMany conditionnel (flashSuggestedAt: null) : idempotent,
  // un second appel sur la même facture est sans effet (count 0).
  async markSuggested(invoiceId: string, organizationId: string): Promise<void> {
    try {
      await organizationScopedClient(this.prisma, organizationId).invoice.updateMany({
        where: { id: invoiceId, organizationId, flashSuggestedAt: null },
        data: { flashSuggestedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `Facture ${invoiceId} : marquage best-effort de la suggestion flash a échoué : ${(error as Error).message}`,
      );
    }
  }
}
