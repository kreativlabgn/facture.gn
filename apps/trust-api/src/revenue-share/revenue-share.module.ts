import { Module } from "@nestjs/common";
import { RevenueShareController } from "./revenue-share.controller";
import { RevenueShareService } from "./revenue-share.service";

@Module({
  controllers: [RevenueShareController],
  providers: [RevenueShareService],
})
export class RevenueShareModule {}
