import { Module } from "@nestjs/common";
import { RenderingService } from "./rendering.service";

// Pas de contrôleur propre : les routes de restitution sont montées sur les
// ressources existantes (invoices/:id/pdf, invoices/:id/payments/:paymentId/
// receipt) pour que RolesGuard résolve l'organisation via l':id facture déjà
// en place. PrismaModule est @Global — pas besoin de l'importer.
@Module({
  providers: [RenderingService],
  exports: [RenderingService],
})
export class RenderingModule {}
