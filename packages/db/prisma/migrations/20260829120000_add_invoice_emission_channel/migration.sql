-- CreateEnum
CREATE TYPE "EmissionChannel" AS ENUM ('pwa', 'ussd', 'agent_terrain', 'api');

-- AlterTable
-- Lot D — canal d'émission. Backfill à 'pwa' : les factures antérieures à ce
-- champ ne portent aucune trace de leur canal réel (*620#, agent terrain ou
-- PWA). 'pwa' = canal primaire, choix honnête "canal inconnu → on suppose le
-- principal". Les nouvelles factures portent le vrai canal, posé côté serveur
-- par InvoicesService.createDraft (2e argument), jamais par le client.
-- ADD COLUMN NOT NULL DEFAULT avec une valeur constante : Postgres >= 11 ne
-- réécrit pas la table.
ALTER TABLE "invoice" ADD COLUMN "emission_channel" "EmissionChannel" NOT NULL DEFAULT 'pwa';
