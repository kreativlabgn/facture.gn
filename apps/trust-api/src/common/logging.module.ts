import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { loggerModuleParams } from "./logging.config";

// Vague 0 (H1) — enveloppe fine autour de nestjs-pino, importée en tête d'AppModule
// (avant tout autre module) pour que le logger soit disponible partout.
@Module({
  imports: [LoggerModule.forRoot(loggerModuleParams)],
  exports: [LoggerModule],
})
export class LoggingModule {}
