-- Passerelle PDP (ADR-107) — table tampon et registre d'idempotence des
-- documents déposés par les ERP tiers (Odoo, OwoDesk).
--
-- DDL écrit à la main, RESTREINT à la table pdp_raw_transaction : `prisma
-- migrate diff` exige une base d'ombre, indisponible ici (ni Postgres local ni
-- Docker au 2026-09-09, même constat que device_enrollment /
-- 20260907030000). Le DDL suit à la lettre ce que Prisma 5.22 produit pour ce
-- modèle — noms d'index et de contraintes compris, sans quoi la prochaine
-- exécution de `migrate diff` verrait une dérive à corriger.
--
-- ── POURQUOI LA SECTION RLS EST INDISPENSABLE ────────────────────────────────
-- pdp_raw_transaction porte organization_id en direct, et son contenu est le
-- corps de facture BRUT d'une PME : montants, clients, références de marché.
-- Sans politique, elle serait le seul trou du registre (29 tables au
-- 2026-09-08). L'application tourne en facture_app (NOBYPASSRLS) depuis
-- l'étape 3 du runbook : une table sans politique y reste intégralement
-- lisible par TOUTE organisation — donc par tout ERP tiers authentifié.
--
-- Le prédicat emploie `nullif(current_setting(...), '')` — pas
-- `current_setting(...) IS NULL`. Voir 20260907010000_rls_dormancy_empty_string :
-- un GUC posé puis relâché revient à la CHAÎNE VIDE, jamais à NULL. Une
-- politique écrite avec IS NULL paraîtrait dormante et bloquerait tout dès la
-- première requête scopée sur la connexion.
--
-- FORCE est posé dans la foulée, pour rester aligné sur les 29 autres tables
-- (20260907020000) : leur migration porte un contrôle qui échoue si une table
-- sous RLS n'a pas FORCE.

-- CreateEnum
CREATE TYPE "PdpFlow" AS ENUM ('e_invoicing', 'e_reporting');

-- CreateEnum
CREATE TYPE "PdpTransactionStatus" AS ENUM ('pending', 'certified', 'failed');

-- CreateTable
CREATE TABLE "pdp_raw_transaction" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_unique_id" TEXT NOT NULL,
    "flow" "PdpFlow" NOT NULL,
    "status" "PdpTransactionStatus" NOT NULL DEFAULT 'pending',
    "total_ht_centimes" BIGINT NOT NULL,
    "total_vat_centimes" BIGINT NOT NULL,
    "total_ttc_centimes" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "certification_id" TEXT,
    "failure_reason" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "pdp_raw_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pdp_raw_transaction_invoice_id_key" ON "pdp_raw_transaction"("invoice_id");

-- CreateIndex
CREATE INDEX "pdp_raw_transaction_organization_id_flow_status_idx" ON "pdp_raw_transaction"("organization_id", "flow", "status");

-- CreateIndex
-- L'INDEX D'IDEMPOTENCE. C'est cette contrainte, et elle seule, qui empêche un
-- connecteur ERP de faire certifier deux fois la même facture : deux requêtes
-- concurrentes portant le même client_unique_id ne peuvent pas toutes deux
-- s'insérer, la perdante reçoit une violation d'unicité (P2002 côté Prisma) que
-- PdpInvoiceService retourne en 200 idempotent. Aucune lecture préalable ne peut
-- remplacer ce verrou : entre le SELECT et l'INSERT il reste toujours une
-- fenêtre, et c'est exactement celle qu'un connecteur qui rejoue son lot après
-- un timeout vient frapper.
CREATE UNIQUE INDEX "pdp_raw_transaction_organization_id_client_unique_id_key" ON "pdp_raw_transaction"("organization_id", "client_unique_id");

-- AddForeignKey
-- onDelete: Restrict partout — un dépôt PDP est une pièce fiscale reçue d'un
-- tiers. Ni l'organisation, ni la clé qui l'a déposé, ni la facture qu'il a
-- produite ne se suppriment en emportant sa trace.
ALTER TABLE "pdp_raw_transaction" ADD CONSTRAINT "pdp_raw_transaction_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdp_raw_transaction" ADD CONSTRAINT "pdp_raw_transaction_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdp_raw_transaction" ADD CONSTRAINT "pdp_raw_transaction_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS : pdp_raw_transaction rejoint le registre ────────────────────────────
ALTER TABLE "pdp_raw_transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pdp_raw_transaction" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "pdp_raw_transaction";
CREATE POLICY org_isolation ON "pdp_raw_transaction" FOR ALL
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pdp_raw_transaction" TO facture_app;
  END IF;
END
$do$;
