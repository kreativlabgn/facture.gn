import { Module } from "@nestjs/common";
import { OrganizationAccessModule } from "../common/rbac/organization-access.module";
import { MarginController } from "./margin.controller";
import { MarginService } from "./margin.service";

@Module({
  imports: [OrganizationAccessModule],
  controllers: [MarginController],
  providers: [MarginService],
})
export class MarginModule {}
