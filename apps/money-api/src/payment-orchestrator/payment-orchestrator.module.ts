import { Global, Module } from "@nestjs/common";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { DjomyStubProvider } from "./providers/djomy-stub.provider";
import { MonerooStubProvider } from "./providers/moneroo-stub.provider";
import { DJOMY_PROVIDER, MONEROO_PROVIDER } from "./payment-orchestrator.tokens";
import { PaymentProviderRegistryService } from "./provider-registry.service";
import type { PaymentProvider } from "./provider.interface";

@Global()
@Module({
  providers: [
    CircuitBreakerService,
    {
      // DJOMY_STUB_SIMULATED_DELAY_MS : réservé aux vérifications manuelles de la
      // bascule primary→fallback (jamais positionné en usage normal) — le registry
      // conserve le timeout dur 10s réel d'ADR-073, non contournable ici.
      provide: DJOMY_PROVIDER,
      useFactory: (): PaymentProvider =>
        new DjomyStubProvider(Number(process.env.DJOMY_STUB_SIMULATED_DELAY_MS ?? 0)),
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
