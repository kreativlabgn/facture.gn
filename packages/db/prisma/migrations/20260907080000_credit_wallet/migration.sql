-- Portefeuille de crédits — registre des mouvements.
--
-- POURQUOI UN REGISTRE ET PAS UNE COLONNE
-- Une simple colonne de solde sur organization aurait suffi à débiter, mais pas
-- à répondre à « pourquoi mon solde a baissé » — la première question que pose
-- un commerçant. credit_transaction est append-only, comme invoice_event
-- (ADR-015) : chaque ligne porte le montant SIGNÉ, le solde résultant, et un
-- libellé lisible. organization.credit_balance_centimes n'en est que la somme
-- dénormalisée, écrite dans la même transaction pour qu'un envoi de SMS n'ait
-- pas à sommer tout l'historique.
--
-- UNITÉ : LE CENTIME GNF, comme partout ailleurs. Pas de jeton maison, qui
-- aurait imposé un taux de change interne à maintenir et à expliquer. Le pack
-- commercial (100 SMS pour 30 000 GNF) reste une façon de vendre, jamais une
-- unité de compte.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
-- credit_transaction porte organization_id en direct : sans politique, elle
-- serait le seul trou du registre (29 tables au 2026-09-07) et le relevé de
-- compte de chaque PME serait lisible par toutes les autres. L'application
-- tourne en facture_app (NOBYPASSRLS) depuis l'étape 2 du runbook.
--
-- Le prédicat emploie nullif(current_setting(...), '') — jamais IS NULL seul.
-- Voir 20260907010000_rls_dormancy_empty_string : un GUC posé puis relâché
-- revient à la CHAÎNE VIDE, et une politique écrite avec IS NULL bloquerait
-- tout dès la première requête scopée sur la connexion.

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('purchase', 'consumption', 'refund', 'adjustment');

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "credit_balance_centimes" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "credit_transaction" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount_centimes" BIGINT NOT NULL,
    "balance_after_centimes" BIGINT NOT NULL,
    "label" TEXT NOT NULL,
    "invoice_id" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_transaction_organization_id_created_at_idx" ON "credit_transaction"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── RLS : credit_transaction rejoint le registre ─────────────────────────────
ALTER TABLE "credit_transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_transaction" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "credit_transaction";
CREATE POLICY org_isolation ON "credit_transaction" FOR ALL
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

-- ALTER DEFAULT PRIVILEGES (script d'armement) couvre les tables créées
-- ensuite, mais on l'explicite pour que la migration soit autonome.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'facture_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "credit_transaction" TO facture_app;
  END IF;
END
$do$;
