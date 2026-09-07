-- Parrainage entre marchands.
--
-- Une ligne par filleul rattaché. Le nom du filleul y est RECOPIÉ, et c'est
-- délibéré : sous RLS le parrain ne voit que ses propres lignes (politique sur
-- referrer_organization_id), l'organisation du filleul lui restant invisible.
-- Sans cet instantané, afficher « qui j'ai parrainé » exigerait une lecture hors
-- scope — un trou dans l'isolation pour un simple libellé.
--
-- referred_organization_id est UNIQUE : un marchand n'est parrainé qu'une fois.
-- Sans cette contrainte, deux parrains pourraient revendiquer le même filleul et
-- toucher chacun la prime. C'est la base qui l'empêche, pas seulement le code.
--
-- organization.referral_code est UNIQUE pour la même raison : c'est lui qui
-- rattache un filleul, une collision enverrait la prime au mauvais parrain.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
-- La politique porte sur referrer_organization_id : chaque parrain voit ses
-- filleuls, personne d'autre. Le prédicat emploie nullif(current_setting(...),'')
-- — voir 20260907010000_rls_dormancy_empty_string.
--
-- Aucune politique sur referred_organization_id : le filleul n'a pas à savoir
-- qu'il rapporte une prime à quelqu'un, et rien dans le produit ne le lui montre.

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'converted');

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "referral_code" TEXT;

-- CreateTable
CREATE TABLE "referral" (
    "id" TEXT NOT NULL,
    "referrer_organization_id" TEXT NOT NULL,
    "referred_organization_id" TEXT NOT NULL,
    "referred_name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "converted_at" TIMESTAMP(3),
    "referrer_bonus_centimes" BIGINT,
    "referred_bonus_centimes" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_referred_organization_id_key" ON "referral"("referred_organization_id");

-- CreateIndex
CREATE INDEX "referral_referrer_organization_id_created_at_idx" ON "referral"("referrer_organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "organization_referral_code_key" ON "organization"("referral_code");

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_referrer_organization_id_fkey" FOREIGN KEY ("referrer_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_referred_organization_id_fkey" FOREIGN KEY ("referred_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS : referral rejoint le registre ───────────────────────────────────────
ALTER TABLE "referral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "referral";
CREATE POLICY org_isolation ON "referral" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR referrer_organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(referrer_organization_id)
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR referrer_organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(referrer_organization_id)
  );

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'facture_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "referral" TO facture_app;
  END IF;
END
$do$;
