# Blueprint : apps/money-api (C2, Phase 1)

## Carte d'implémentation — ordre d'écriture

1. `apps/money-api/package.json`, `tsconfig.json`, `nest-cli.json` — miroir `trust-api`, dépendances réduites (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@facture-gn/db`, `reflect-metadata`, `rxjs`, `zod`)
2. `apps/money-api/src/common/prisma.module.ts` — copie conforme de `trust-api`
3. `packages/db/prisma/schema.prisma` — enums + modèle (voir ci-dessous), migration, `prisma generate`
4. `apps/money-api/src/payment-orchestrator/provider.interface.ts`
5. `apps/money-api/src/payment-orchestrator/circuit-breaker.service.ts` (+ spec)
6. `apps/money-api/src/payment-orchestrator/providers/djomy-stub.provider.ts` (+ spec)
7. `apps/money-api/src/payment-orchestrator/providers/moneroo-stub.provider.ts` (+ spec)
8. `apps/money-api/src/payment-orchestrator/provider-registry.service.ts` (+ spec)
9. `apps/money-api/src/payment-orchestrator/payment-orchestrator.module.ts`
10. `apps/money-api/src/payment-links/dto/create-payment-link.dto.ts` (+ spec)
11. `apps/money-api/src/payment-links/payment-links.service.ts` (+ spec)
12. `apps/money-api/src/payment-links/payment-links.controller.ts`
13. `apps/money-api/src/payment-links/payment-links.module.ts`
14. `apps/money-api/src/app.module.ts`, `src/main.ts`, `.env.example`

## Schéma Prisma — ajout

```prisma
enum PaymentProviderName {
  djomy
  moneroo
  orange_direct
  mtn_direct
}

enum PaymentProviderAttemptStatus {
  pending
  success
  failed
  timeout
}

// ADR-076 — traçabilité par tentative, y compris les bascules primary→fallback.
// Propriété d'écriture exclusive de money-api (Trust Context ne modifie jamais
// cette table), même base Postgres partagée via packages/db.
model PaymentProviderAttempt {
  id        String @id @default(uuid())
  invoiceId String @map("invoice_id")

  provider PaymentProviderName
  status   PaymentProviderAttemptStatus @default(pending)

  providerRef String? @map("provider_ref")
  amountGnf   BigInt  @map("amount_gnf")
  feeGateway  BigInt  @default(0) @map("fee_gateway")
  feePlatform BigInt  @default(0) @map("fee_platform")

  createdAt DateTime  @default(now()) @map("created_at")
  settledAt DateTime? @map("settled_at")

  @@map("payment_provider_attempt")
}
```

## Interface PaymentProvider

```typescript
// provider.interface.ts
export interface CreatePaymentLinkRequest {
  invoiceId: string;
  organizationId: string;
  amountGnf: bigint;
  idempotencyKey: string; // invoiceId + ':' + provider (ADR-073), construit par le registry
}

export interface CreatePaymentLinkResult {
  provider: PaymentProviderName;
  providerRef: string;
  paymentLinkUrl: string;
  feeGatewayGnf: bigint;
  expiresAt: Date;
}

export interface VerifyTransactionResult {
  status: "pending" | "success" | "failed";
  providerRef: string;
  settledAt?: Date;
}

export interface NormalizedWebhookResult {
  providerRef: string;
  status: "paid" | "failed" | "pending";
  signatureValid: boolean;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createPaymentLink(request: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResult>;
  verifyTransaction(providerRef: string): Promise<VerifyTransactionResult>;
  handleWebhook(rawPayload: unknown): NormalizedWebhookResult;
}
```

## CircuitBreakerService — générique

```typescript
export class ProviderTimeoutError extends Error {}

@Injectable()
export class CircuitBreakerService {
  async callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new ProviderTimeoutError(`Timeout après ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }
}
```

## Stub Djomy (Moneroo identique, `provider: "moneroo"`, sans frais gateway 1%)

```typescript
@Injectable()
export class DjomyStubProvider implements PaymentProvider {
  readonly name: PaymentProviderName = "djomy";

  // Non branché sur la DI Nest par défaut — construit avec un délai par les tests
  // du circuit breaker uniquement (voir payment-orchestrator.module.ts : useFactory
  // sans argument = délai 0 en usage réel).
  constructor(private readonly simulatedDelayMs = 0) {}

  async createPaymentLink(request: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResult> {
    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }
    // TODO(Djomy réel, ADR-072) : POST /confirm_otp puis /verify_payment, Djomy.africa —
    // Orange Money + MTN MoMo Guinée directs, frais 1% annoncés. Stub déterministe faute
    // de credentials sandbox ; interface stable, migration sans impact appelants.
    const providerRef = `djomy-stub-${request.invoiceId}`;
    return {
      provider: "djomy",
      providerRef,
      paymentLinkUrl: `https://stub.djomy.africa/pay/${providerRef}`,
      feeGatewayGnf: (request.amountGnf * 1n) / 100n,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }

  async verifyTransaction(providerRef: string): Promise<VerifyTransactionResult> {
    return { status: "success", providerRef, settledAt: new Date() };
  }

  handleWebhook(rawPayload: unknown): NormalizedWebhookResult {
    const payload = rawPayload as { provider_ref: string };
    return { providerRef: payload.provider_ref, status: "paid", signatureValid: true };
  }
}
```

## PaymentProviderRegistryService — jamais d'erreur avalée

```typescript
const DJOMY_TIMEOUT_MS = 10_000; // ADR-073, timeout dur
const MONEROO_MAX_ATTEMPTS = 2; // retry x2 côté Moneroo, ADR-073

@Injectable()
export class PaymentProviderRegistryService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly circuitBreaker: CircuitBreakerService,
    @Inject(DJOMY_PROVIDER) private readonly djomy: PaymentProvider,
    @Inject(MONEROO_PROVIDER) private readonly moneroo: PaymentProvider,
  ) {}

  async resolve(request: Omit<CreatePaymentLinkRequest, "idempotencyKey">): Promise<CreatePaymentLinkResult> {
    const djomyResult = await this.tryProvider(this.djomy, request, DJOMY_TIMEOUT_MS);
    if (djomyResult) return djomyResult;

    for (let attempt = 1; attempt <= MONEROO_MAX_ATTEMPTS; attempt++) {
      const monerooResult = await this.tryProvider(this.moneroo, request, DJOMY_TIMEOUT_MS);
      if (monerooResult) return monerooResult;
    }

    throw new ServiceUnavailableException(
      `Aucun provider disponible pour la facture ${request.invoiceId} — Djomy et Moneroo (x${MONEROO_MAX_ATTEMPTS}) ont tous échoué`,
    );
  }

  // Retour null (jamais une exception avalée) = signal explicite "tente le suivant" ;
  // l'échec est déjà tracé en DB avant ce retour, jamais silencieux.
  private async tryProvider(
    provider: PaymentProvider,
    request: Omit<CreatePaymentLinkRequest, "idempotencyKey">,
    timeoutMs: number,
  ): Promise<CreatePaymentLinkResult | null> {
    const idempotencyKey = `${request.invoiceId}:${provider.name}`;
    try {
      const result = await this.circuitBreaker.callWithTimeout(
        () => provider.createPaymentLink({ ...request, idempotencyKey }),
        timeoutMs,
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
    request: Omit<CreatePaymentLinkRequest, "idempotencyKey">,
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
```

## Module de câblage

```typescript
// payment-orchestrator.module.ts
export const DJOMY_PROVIDER = Symbol("DJOMY_PROVIDER");
export const MONEROO_PROVIDER = Symbol("MONEROO_PROVIDER");

@Global()
@Module({
  providers: [
    CircuitBreakerService,
    { provide: DJOMY_PROVIDER, useFactory: (): PaymentProvider => new DjomyStubProvider() },
    { provide: MONEROO_PROVIDER, useFactory: (): PaymentProvider => new MonerooStubProvider() },
    PaymentProviderRegistryService,
  ],
  exports: [PaymentProviderRegistryService],
})
export class PaymentOrchestratorModule {}
```

`payment-links.service.ts` délègue directement à `registry.resolve()`. `payment-links.controller.ts` : `POST /payment-links`, DTO Zod (`invoiceId`/`organizationId` UUID, `amountGnf` bigint positif), pas de `@Roles()`/`@Public()` — pas de guard global dans `money-api` cette phase (aucun `AuthModule` importé, cohérent avec le Risque 2 du plan).

## Flux de données

`POST /payment-links` → `PaymentLinksController.create()` → `PaymentLinksService.createPaymentLink()` → `PaymentProviderRegistryService.resolve()` → `tryProvider(djomy)` via `CircuitBreakerService.callWithTimeout(10s)` → succès : `PaymentProviderAttempt(status: success)` + retour ; timeout/échec : `PaymentProviderAttempt(status: timeout|failed)` → boucle Moneroo x2 → succès ou `ServiceUnavailableException`.

## Séquence de build

1. Scaffold + `PrismaModule` (tâches 1-2)
2. Schéma + migration (tâches 3-4) — `dev-tdd-enforcer` non applicable ici (infra pure)
3. `provider.interface.ts` (tâche 5, types seuls, pas de test dédié)
4. `CircuitBreakerService` + spec (RED→GREEN, tâche 8 du plan)
5. `DjomyStubProvider`/`MonerooStubProvider` + specs (tâches 6-7)
6. `PaymentProviderRegistryService` + specs (tâche 9) — le composant le plus critique, RED→GREEN→REFACTOR soigné
7. `PaymentLinksService`/`Controller`/`Module` + specs (tâches 10-11)
8. `app.module.ts`/`main.ts`/`.env.example`
9. Vérification E2E réelle (démarrage indépendant, bascule Djomy→Moneroo observée)
10. `dev-code-reviewer`

Blueprint validé. Prêt pour `dev-tdd-enforcer` sur la première tâche de la séquence de build.
