import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

// Les montants (ADR-014, entiers GNF) sont des BigInt côté Prisma — JSON.stringify
// ne sait pas les sérialiser nativement. En string plutôt qu'en number pour ne
// jamais perdre de précision au-delà de Number.MAX_SAFE_INTEGER.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  // rawBody: true (F11, ADR-082) — expose request.rawBody (Buffer) SANS affecter
  // le parsing JSON normal des autres routes. Requis par PartnerWebhookAuthGuard
  // pour vérifier HMAC-SHA256 sur le corps EXACTEMENT tel que reçu — un
  // JSON.stringify(request.body) reconstruit ne serait pas bit-à-bit identique
  // au corps réellement signé par l'expéditeur (ordre des clés, espacement).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const config = new DocumentBuilder()
    .setTitle("facture.gn — Trust API")
    .setDescription("Trust Context : IAM, organisations, facturation core, certification")
    .setVersion("0.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
