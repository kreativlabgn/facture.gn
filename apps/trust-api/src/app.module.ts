import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggingModule } from "./common/logging.module";
import { HealthModule } from "./health/health.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PrismaModule } from "./common/prisma.module";
import { CertificationModule } from "./certification/certification.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { MoneyClientModule } from "./money-client/money-client.module";
import { PaymentsModule } from "./payments/payments.module";
import { CreditNotesModule } from "./credit-notes/credit-notes.module";
import { RefundsModule } from "./refunds/refunds.module";
import { PracticesModule } from "./practices/practices.module";
import { MandatesModule } from "./mandates/mandates.module";
import { FecModule } from "./fec/fec.module";
import { CustomersModule } from "./customers/customers.module";
import { BranchesModule } from "./branches/branches.module";
import { PartnersModule } from "./partners/partners.module";
import { VerificationModule } from "./verification/verification.module";
import { CabinetViewModule } from "./cabinet-view/cabinet-view.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { UssdModule } from "./ussd/ussd.module";
import { PublicBuyerModule } from "./public-buyer/public-buyer.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { DevicesModule } from "./devices/devices.module";
import { ProductsModule } from "./products/products.module";
import { ProductStockModule } from "./product-stock/product-stock.module";
import { MarginModule } from "./margin/margin.module";
import { RevenueShareModule } from "./revenue-share/revenue-share.module";
import { FinancingModule } from "./financing/financing.module";
import { RecurringTemplatesModule } from "./recurring-templates/recurring-templates.module";
import { CommissionBypassModule } from "./commission-bypass/commission-bypass.module";
import { ClientPortalModule } from "./client-portal/client-portal.module";
import { EtaxModule } from "./etax/etax.module";
import { FiscalPeriodsModule } from "./fiscal-periods/fiscal-periods.module";
import { QueueModule } from "./queue/queue.module";
import { RetentionModule } from "./retention/retention.module";
import { MerkleAnchorModule } from "./certification/merkle-anchor/merkle-anchor.module";
import { DataRightsModule } from "./data-rights/data-rights.module";
import { BankReconciliationModule } from "./bank-reconciliation/bank-reconciliation.module";
import { PendingMemberInvitesModule } from "./pending-member-invites/pending-member-invites.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./common/rbac/roles.guard";

@Module({
  imports: [
    // Vague 0 (H1) — en premier : journalisation structurée + redaction PII
    // disponible pour tous les modules suivants.
    LoggingModule,
    // Lot F — observabilité HTTP (health + /metrics + intercepteur global).
    MetricsModule,
    HealthModule,
    // Security Audit 2026-08-23, finding #10 — filet générique par IP (100 req/min,
    // valeur raisonnable par défaut, ajustable) : aucun mécanisme de rate limiting
    // HTTP n'existait auparavant. Vient EN PLUS des verrous applicatifs déjà
    // existants (PIN USSD : PIN_MAX_ATTEMPTS/PIN_LOCKOUT_MS), jamais un remplacement.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    PrismaModule,
    // Lot J3 — brique BullMQ (@Global) : connexion Redis lazyConnect partagée.
    QueueModule,
    PendingMemberInvitesModule,
    AuthModule,
    CertificationModule,
    MoneyClientModule,
    OrganizationsModule,
    InvoicesModule,
    PaymentsModule,
    CreditNotesModule,
    RefundsModule,
    PracticesModule,
    MandatesModule,
    FecModule,
    CustomersModule,
    BranchesModule,
    PartnersModule,
    VerificationModule,
    CabinetViewModule,
    NotificationsModule,
    UssdModule,
    PublicBuyerModule,
    ApiKeysModule,
    DevicesModule,
    ProductsModule,
    ProductStockModule,
    MarginModule,
    RevenueShareModule,
    FinancingModule,
    RecurringTemplatesModule,
    CommissionBypassModule,
    ClientPortalModule,
    FiscalPeriodsModule,
    EtaxModule,
    // Lot J3 — purge périodique des tables opérationnelles éphémères.
    RetentionModule,
    // Lot E1 — registre Merkle des factures + seam d'ancrage externe (opt-in).
    MerkleAnchorModule,
    // Lot J2 — droits des personnes (L/2016/037) : accès + anonymisation.
    DataRightsModule,
    // Lot rapprochement bancaire (ADR-052) — import de relevé, suggestion de
    // correspondance facture, confirmation manuelle (chemin C3 réutilisé).
    BankReconciliationModule,
  ],
  providers: [
    // Ordre significatif : ThrottlerGuard s'exécute en premier (rejette avant même
    // toute vérification d'identité coûteuse), puis JwtAuthGuard peuple
    // request.user avant que RolesGuard ne le lise pour résoudre le membership
    // organisationnel.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
