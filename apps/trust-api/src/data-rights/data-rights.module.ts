import { Module } from "@nestjs/common";

import { DataRightsController } from "./data-rights.controller";
import { DataRightsInternalAuthGuard } from "./data-rights-internal-auth.guard";
import { DataRightsService } from "./data-rights.service";
import { InternalDataRightsController } from "./internal-data-rights.controller";

// J2, ADR-116 — droits des personnes (L/2016/037). Aucune dépendance vers
// CustomersModule : DataRightsService fait ses propres requêtes Prisma
// (PRISMA_CLIENT est @Global).
@Module({
  controllers: [DataRightsController, InternalDataRightsController],
  providers: [DataRightsService, DataRightsInternalAuthGuard],
})
export class DataRightsModule {}
