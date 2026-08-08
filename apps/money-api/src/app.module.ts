import { Module } from "@nestjs/common";
import { PrismaModule } from "./common/prisma.module";
import { PaymentOrchestratorModule } from "./payment-orchestrator/payment-orchestrator.module";
import { PaymentLinksModule } from "./payment-links/payment-links.module";

@Module({
  imports: [PrismaModule, PaymentOrchestratorModule, PaymentLinksModule],
})
export class AppModule {}
