import { Module } from "@nestjs/common";
import { OrganizationAccessModule } from "../common/rbac/organization-access.module";
import { FecController } from "./fec.controller";
import { FecService } from "./fec.service";

@Module({
  imports: [OrganizationAccessModule],
  controllers: [FecController],
  providers: [FecService],
})
export class FecModule {}
