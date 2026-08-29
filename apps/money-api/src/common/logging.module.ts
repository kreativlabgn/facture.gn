import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { loggerModuleParams } from "./logging.config";

// Vague 0 (H1) — voir apps/trust-api/src/common/logging.module.ts.
@Module({
  imports: [LoggerModule.forRoot(loggerModuleParams)],
  exports: [LoggerModule],
})
export class LoggingModule {}
