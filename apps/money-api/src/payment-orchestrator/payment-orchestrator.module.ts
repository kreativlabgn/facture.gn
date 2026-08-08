import { Global, Module } from "@nestjs/common";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { DjomyStubProvider } from "./providers/djomy-stub.provider";
import { MonerooStubProvider } from "./providers/moneroo-stub.provider";
import { DJOMY_PROVIDER, MONEROO_PROVIDER } from "./payment-orchestrator.tokens";
import { PaymentProviderRegistryService } from "./provider-registry.service";
import type { PaymentProvider } from "./provider.interface";

// Réservé aux vérifications manuelles de la bascule primary→fallback (jamais en
// usage normal) — le registry conserve le timeout dur 10s réel d'ADR-073, non
// contournable ici. Fail-fast plutôt que silencieux : sans ce garde, une variable
// oubliée en production dérouterait tout le trafic vers Moneroo sans avertissement,
// contournant Djomy en continu (contredit ADR-072 : Djomy primary, économie de
// commission modélisée dans la projection M18 d'ADR-074).
export function resolveDjomyStubDelayMs(): number {
  const raw = process.env.DJOMY_STUB_SIMULATED_DELAY_MS;
  if (!raw) {
    return 0;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DJOMY_STUB_SIMULATED_DELAY_MS ne doit jamais être positionné en production — " +
        "réservé aux vérifications manuelles de la bascule primary→fallback (C2 Phase 1)",
    );
  }
  return Number(raw);
}

@Global()
@Module({
  providers: [
    CircuitBreakerService,
    {
      provide: DJOMY_PROVIDER,
      useFactory: (): PaymentProvider => new DjomyStubProvider(resolveDjomyStubDelayMs()),
    },
    {
      provide: MONEROO_PROVIDER,
      useFactory: (): PaymentProvider => new MonerooStubProvider(),
    },
    PaymentProviderRegistryService,
  ],
  exports: [PaymentProviderRegistryService],
})
export class PaymentOrchestratorModule {}
