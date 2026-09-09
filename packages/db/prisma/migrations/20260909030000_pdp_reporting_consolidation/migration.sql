-- Réacteur de consolidation e-Reporting B2C (ADR-107 tranche 3, ADR-108, LFI 2025).
--
-- Ce que cette migration rend possible : compiler les micro-ventes de caisse
-- déposées par les ERP tiers (Odoo, OwoDesk) en une facture de synthèse unique
-- (Z de caisse), certifiée puis transmise à la DGI — au lieu d'inonder le guichet
-- de l'État d'un document par ticket.
--
-- DDL écrit à la main, comme 20260909010000_pdp_raw_transaction : `prisma migrate
-- diff` exige une base d'ombre, indisponible ici (ni Postgres local ni Docker au
-- 2026-09-09). Le DDL suit à la lettre ce que Prisma 5.22 produit pour ces
-- modèles — noms d'index et de contraintes compris, sans quoi la prochaine
-- exécution de `migrate diff` verrait une dérive à corriger.
--
-- ── TROIS OBJETS, ET POURQUOI AUCUN N'EST FACULTATIF ─────────────────────────
--
-- 1. pdp_raw_transaction.consolidated_invoice_id — le rattachement N→1 des
--    tickets au Z qui les agrège. Il ne pouvait PAS réutiliser invoice_id :
--    celui-ci porte un index UNIQUE (pdp_raw_transaction_invoice_id_key), qui
--    encode l'invariant du flux unitaire « une facture ne répond que d'UN
--    document ERP ». Cinquante tickets sur un même Z le violeraient dès le
--    deuxième, et lever ce UNIQUE pour y arriver rouvrirait côté e-invoicing la
--    porte que la tranche 2 avait fermée.
--
-- 2. invoice.reporting_series_number — la série séquentielle dédiée au
--    e-Reporting (ZR-YYYY-NNNNNN). Elle S'AJOUTE au numéro légal Article 23
--    (invoice.number), elle ne le remplace pas : un Z de caisse est une facture
--    certifiée comme une autre et consomme un numéro de la séquence « sans trou »
--    de l'organisation. Sortir tout un flux de cette séquence serait un arbitrage
--    juridique, jamais une décision d'implémentation.
--
-- 3. pdp_reporting_sequence — le compteur de cette série, jumeau exact
--    d'invoice_sequence et délibérément séparé d'elle. Mêler deux numérotations
--    dans une table dont l'une est opposable en contrôle fiscal se paierait au
--    premier écart.

-- AlterTable
ALTER TABLE "pdp_raw_transaction" ADD COLUMN "consolidated_invoice_id" TEXT;

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN "reporting_series_number" TEXT;

-- CreateTable
CREATE TABLE "pdp_reporting_sequence" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pdp_reporting_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- La clé de l'upsert atomique. C'est ce UNIQUE, et lui seul, qui rend
-- `INSERT ... ON CONFLICT (organization_id, year) DO UPDATE SET last_number =
-- last_number + 1 RETURNING last_number` sérialisable : deux consolidations
-- concurrentes de la même organisation ne peuvent pas rendre le même rang.
-- Sans lui, ON CONFLICT n'a aucun arbitre et l'instruction échoue.
CREATE UNIQUE INDEX "pdp_reporting_sequence_organization_id_year_key" ON "pdp_reporting_sequence"("organization_id", "year");

-- CreateIndex
-- La piste d'audit DESCENDANTE : « quels tickets composent ce Z ? ». Question
-- posée à chaque contrôle DGI et à chaque contestation client. pdp_raw_transaction
-- est par construction la table la plus volumineuse du schéma (une ligne par
-- ticket de caisse) — sans index, la réponse coûte un scan complet.
CREATE INDEX "pdp_raw_transaction_consolidated_invoice_id_idx" ON "pdp_raw_transaction"("consolidated_invoice_id");

-- CreateIndex
-- Composite avec organization_id, jamais un UNIQUE seul sur la colonne : la série
-- ZR repart à 1 chez chaque organisation, deux PME ont donc toutes deux un
-- ZR-2026-000001 — même précédent qu'invoice(organization_id, number).
-- Postgres autorise autant de NULL qu'on veut sous un index unique : les factures
-- ordinaires, qui ne portent aucun numéro de série, ne se gênent jamais entre elles.
CREATE UNIQUE INDEX "invoice_organization_id_reporting_series_number_key" ON "invoice"("organization_id", "reporting_series_number");

-- AddForeignKey
-- onDelete: Restrict, comme les trois FK déjà posées sur cette table : un Z de
-- caisse certifié ne se supprime pas, et s'il le pouvait il n'emporterait jamais
-- la trace des tickets qui le composent.
ALTER TABLE "pdp_raw_transaction" ADD CONSTRAINT "pdp_raw_transaction_consolidated_invoice_id_fkey" FOREIGN KEY ("consolidated_invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdp_reporting_sequence" ADD CONSTRAINT "pdp_reporting_sequence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS : pdp_reporting_sequence rejoint le registre ─────────────────────────
--
-- La table ne porte aucun montant, mais elle porte organization_id et un rang de
-- série : sans politique, le nombre de Z de caisse émis par une PME concurrente
-- serait lisible par tout ERP tiers authentifié, et surtout son compteur serait
-- INCRÉMENTABLE par n'importe quel locataire. L'application tourne en facture_app
-- (NOBYPASSRLS) depuis l'étape 3 du runbook : une table sans politique y reste
-- intégralement ouverte.
--
-- Prédicat identique mot pour mot à celui d'invoice_sequence et des 30 autres
-- tables du registre. `nullif(current_setting(...), '')` et non
-- `current_setting(...) IS NULL` — voir 20260907010000_rls_dormancy_empty_string :
-- un GUC posé puis relâché revient à la CHAÎNE VIDE, jamais à NULL, et une
-- politique écrite avec IS NULL paraîtrait dormante puis bloquerait tout dès la
-- première requête scopée sur la connexion.
--
-- FORCE dans la foulée, pour rester aligné sur le contrôle de 20260907020000 qui
-- échoue si une table sous RLS ne l'a pas.
ALTER TABLE "pdp_reporting_sequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pdp_reporting_sequence" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "pdp_reporting_sequence";
CREATE POLICY org_isolation ON "pdp_reporting_sequence" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(organization_id)
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(organization_id)
  );

-- Le rôle applicatif : ALTER DEFAULT PRIVILEGES (script d'armement) couvre les
-- tables créées ensuite, mais on l'explicite ici pour que cette migration soit
-- autonome — rejouable sur une base où le rôle existe déjà.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'facture_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pdp_reporting_sequence" TO facture_app;
  END IF;
END
$do$;
