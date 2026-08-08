import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { PaymentProviderName, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { CircuitBreakerService, ProviderTimeoutError } from "./circuit-breaker.service";
import { DJOMY_PROVIDER, MONEROO_PROVIDER } from "./payment-orchestrator.tokens";
import type { CreatePaymentLinkRequest, CreatePaymentLinkResult, PaymentProvider } from "./provider.interface";

const DJOMY_TIMEOUT_MS = 10_000; // ADR-073, timeout dur
const MONEROO_MAX_ATTEMPTS = 2; // retry x2 côté Moneroo, ADR-073

type ResolveRequest = Omit<CreatePaymentLinkRequest, "idempotencyKey">;

@Injectable()
export class PaymentProviderRegistryService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly circuitBreaker: CircuitBreakerService,
    @Inject(DJOMY_PROVIDER) private readonly djomy: PaymentProvider,
    @Inject(MONEROO_PROVIDER) private readonly moneroo: PaymentProvider,
    // Timeout injectable (défaut ADR-073) — permet aux tests de ne pas attendre
    // 10 vraies secondes pour exercer le chemin timeout (Risque 3 du plan).
    // @Optional() : un paramètre number sans provider DI ferait échouer la
    // résolution Nest au démarrage sans ce décorateur (undefined explicite déclenche
    // le défaut JS, sinon Nest lève "can't resolve dependencies").
    @Optional() private readonly djomyTimeoutMs: number = DJOMY_TIMEOUT_MS,
  ) {}

  async resolve(request: ResolveRequest): Promise<CreatePaymentLinkResult> {
    const djomyResult = await this.tryProvider(this.djomy, request);
    if (djomyResult) {
      return djomyResult;
    }

    for (let attempt = 1; attempt <= MONEROO_MAX_ATTEMPTS; attempt++) {
      const monerooResult = await this.tryProvider(this.moneroo, request);
      if (monerooResult) {
        return monerooResult;
      }
    }

    throw new ServiceUnavailableException(
      `Aucun provider disponible pour la facture ${request.invoiceId} — Djomy et Moneroo (x${MONEROO_MAX_ATTEMPTS}) ont tous échoué`,
    );
  }

  // Retour null (jamais une exception avalée) = signal explicite "tente le suivant" —
  // l'échec est déjà tracé en base avant ce retour, jamais silencieux.
  private async tryProvider(
    provider: PaymentProvider,
    request: ResolveRequest,
  ): Promise<CreatePaymentLinkResult | null> {
    const idempotencyKey = `${request.invoiceId}:${provider.name}`;
    try {
      const result = await this.circuitBreaker.callWithTimeout(
        () => provider.createPaymentLink({ ...request, idempotencyKey }),
        this.djomyTimeoutMs,
      );
      await this.recordAttempt(request, provider.name, "success", result);
      return result;
    } catch (error) {
      const status = error instanceof ProviderTimeoutError ? "timeout" : "failed";
      await this.recordAttempt(request, provider.name, status);
      return null;
    }
  }

  private async recordAttempt(
    request: ResolveRequest,
    provider: PaymentProviderName,
    status: "success" | "failed" | "timeout",
    result?: CreatePaymentLinkResult,
  ): Promise<void> {
    await this.prisma.paymentProviderAttempt.create({
      data: {
        invoiceId: request.invoiceId,
        provider,
        status,
        providerRef: result?.providerRef,
        amountGnf: request.amountGnf,
        feeGateway: result?.feeGatewayGnf ?? 0n,
        settledAt: status === "success" ? new Date() : null,
      },
    });
  }
}
