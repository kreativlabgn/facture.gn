import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../common/platform-admin.guard";
import { InfrastructureService } from "./infrastructure.service";

@ApiTags("platform-infrastructure")
@ApiBearerAuth()
@Controller("platform/infrastructure")
@UseGuards(PlatformAdminGuard)
export class InfrastructureController {
  constructor(private readonly infrastructure: InfrastructureService) {}

  @Get()
  snapshot() {
    return this.infrastructure.snapshot();
  }
}
