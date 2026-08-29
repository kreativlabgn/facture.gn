import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoggingModule } from "./common/logging.module";
import { PrismaModule } from "./common/prisma.module";
import { RequireExplicitAuthGuard } from "./common/require-explicit-auth.guard";
import { PaymentOrchestratorModule } from "./payment-orchestrator/payment-orchestrator.module";
import { PaymentLinksModule } from "./payment-links/payment-links.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    // Vague 0 (H1) — en premier : journalisation structurée + redaction PII.
    LoggingModule,
    PrismaModule,
    PaymentOrchestratorModule,
    PaymentLinksModule,
    WebhooksModule,
  ],
  providers: [
    // Security Audit 2026-08-23, finding #16 — deny-by-default structurel : toute
    // route sans @Public() est rejetée (403). Voir require-explicit-auth.guard.ts.
    { provide: APP_GUARD, useClass: RequireExplicitAuthGuard },
  ],
})
export class AppModule {}
