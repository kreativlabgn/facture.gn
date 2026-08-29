import "reflect-metadata";
// Lot H — DOIT rester en 2e : démarre les traces OTel (si activées) avant que
// @nestjs/core / express ne soient chargés, sinon l'instrumentation les rate.
import "./observability/register";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

// Les montants (ADR-014, entiers GNF) sont des BigInt côté Prisma — JSON.stringify
// ne sait pas les sérialiser nativement. En string plutôt qu'en number pour ne
// jamais perdre de précision au-delà de Number.MAX_SAFE_INTEGER.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Security Audit 2026-08-23, finding #15 — voir apps/trust-api/src/main.ts.
  app.use(helmet());

  // Security Audit 2026-08-23, finding #5 — voir apps/trust-api/src/main.ts : même
  // gate, SwaggerModule.setup() n'est jamais couvert par les guards Nest.
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("facture.gn — Money API")
      .setDescription("Money Context : orchestrateur de paiement multi-provider (Djomy/Moneroo)")
      .setVersion("0.0.0")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
}

void bootstrap();
