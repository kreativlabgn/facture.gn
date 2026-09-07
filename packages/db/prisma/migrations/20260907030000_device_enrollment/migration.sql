-- Enrôlement matériel — modèle Device (chantier 2).
--
-- Le DDL ci-dessous est celui produit par `prisma migrate diff`, RESTREINT à la
-- table device : le diff brut embarquait deux dérives préexistantes du schéma
-- (clause ON DELETE de pending_member_invite_resolved_user_id_fkey, renommage
-- d'index sur revenue_share_credit). Les emporter dans cette migration les
-- aurait rendues invisibles en revue — elles sont signalées à part.
--
-- ── POURQUOI LA SECTION RLS EST INDISPENSABLE ────────────────────────────────
-- `device` porte organization_id en direct : sans politique, elle serait le seul
-- trou du registre (28 tables au 2026-09-07). L'application tourne en
-- facture_app (NOBYPASSRLS) depuis l'étape 3 du runbook : une table sans
-- politique y reste intégralement lisible par toute organisation.
--
-- Le prédicat emploie `nullif(current_setting(...), '')` — pas
-- `current_setting(...) IS NULL`. Voir 20260907010000_rls_dormancy_empty_string :
-- un GUC posé puis relâché revient à la CHAÎNE VIDE, jamais à NULL. Une
-- politique écrite avec IS NULL paraîtrait dormante et bloquerait tout dès la
-- première requête scopée sur la connexion.
--
-- FORCE est posé dans la foulée, pour rester aligné sur les 28 autres tables
-- (20260907020000) : leur migration porte un contrôle qui échoue si une table
-- sous RLS n'a pas FORCE.

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('pending', 'active', 'revoked');

-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "label" TEXT NOT NULL,
    "imei_or_serial" TEXT NOT NULL,
    "public_key" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'pending',
    "enrollment_token_hash" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "token_consumed_at" TIMESTAMP(3),
    "provisioned_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrolled_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_imei_or_serial_key" ON "device"("imei_or_serial");

-- CreateIndex
CREATE INDEX "device_enrollment_token_hash_idx" ON "device"("enrollment_token_hash");

-- CreateIndex
CREATE INDEX "device_organization_id_status_idx" ON "device"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_provisioned_by_user_id_fkey" FOREIGN KEY ("provisioned_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── RLS : device rejoint le registre ─────────────────────────────────────────
ALTER TABLE "device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "device";
CREATE POLICY org_isolation ON "device" FOR ALL
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "device" TO facture_app;
  END IF;
END
$do$;
