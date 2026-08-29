import "reflect-metadata";
// Lot H — DOIT rester en 2e : démarre les traces OTel (si activées) avant que
// @nestjs/core / express ne soient chargés, sinon l'instrumentation les rate.
import "./observability/register";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { assertSecretsValid, TRUST_API_SECRETS } from "./common/secrets";

// Les montants (ADR-014, entiers GNF) sont des BigInt côté Prisma — JSON.stringify
// ne sait pas les sérialiser nativement. En string plutôt qu'en number pour ne
// jamais perdre de précision au-delà de Number.MAX_SAFE_INTEGER.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  // Lot J (C5) — valide TOUS les secrets d'un coup avant de démarrer Nest.
  // Fonction pure hors du graphe DI → n'affecte pas app.module.spec.ts.
  assertSecretsValid(process.env, TRUST_API_SECRETS, {
    production: process.env.NODE_ENV === "production",
  });

  // rawBody: true (F11, ADR-082) — expose request.rawBody (Buffer) SANS affecter
  // le parsing JSON normal des autres routes. Requis par PartnerWebhookAuthGuard
  // pour vérifier HMAC-SHA256 sur le corps EXACTEMENT tel que reçu — un
  // JSON.stringify(request.body) reconstruit ne serait pas bit-à-bit identique
  // au corps réellement signé par l'expéditeur (ordre des clés, espacement).
  // bufferLogs (H1) — les logs du démarrage sont mis en tampon puis rejoués par
  // le logger pino une fois qu'il est résolu ci-dessous, jamais perdus ni émis
  // en format console non structuré.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Security Audit 2026-08-23, finding #15 — config par défaut de helmet (HSTS,
  // X-Content-Type-Options, X-Frame-Options DENY, etc.), aucune sur-configuration :
  // suffisant en défense en profondeur, l'API ne sert que du JSON (pas de rendu
  // HTML propre à durcir via une CSP dédiée ici).
  app.use(helmet());

  // Security Audit 2026-08-23, finding #5 — SwaggerModule.setup() monte son propre
  // routeur Express directement, EN DEHORS du pipeline de guards Nest (le
  // JwtAuthGuard/RolesGuard global d'app.module.ts ne le protège pas) : en
  // production, /docs exposait sans authentification la totalité des schémas
  // DTO et la liste des routes sensibles (api-keys, commercial-agents/grant...) —
  // une carte de reconnaissance gratuite pour un attaquant.
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("facture.gn — Trust API")
      .setDescription("Trust Context : IAM, organisations, facturation core, certification")
      .setVersion("0.0.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();
