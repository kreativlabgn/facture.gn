import { Module } from "@nestjs/common";
import { OrganizationAccessService } from "./organization-access.service";

@Module({
  providers: [OrganizationAccessService],
  exports: [OrganizationAccessService],
})
export class OrganizationAccessModule {}
