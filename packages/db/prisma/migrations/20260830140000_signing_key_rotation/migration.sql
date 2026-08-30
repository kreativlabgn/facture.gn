-- Lot E3 (ADR-114 provisoire, DAT §Crypto "rotation 365j") — rotation de la clé
-- racine de signature par organisation.
--
-- Passe de "1 clé à vie par organisation" (organization_id UNIQUE) à "N clés
-- dans le temps, AU PLUS UNE active". L'invariant "une seule active" est encodé
-- en base par un index unique PARTIEL (précédent : pending_member_invite_one_live_per_org,
-- migration 20260823160000), jamais uniquement en applicatif.
--
-- Les lignes existantes (exactement 1 par organisation, retired_at NULL,
-- revoked_at NULL ou non) satisfont le nouvel index partiel.

-- 1. Retirer l'unicité stricte sur organization_id (créée par Prisma comme un
--    index unique, PAS une contrainte nommée — cf. 20260810110000).
DROP INDEX "organization_signing_key_organization_id_key";

-- 2. Colonne retired_at (clé remplacée par rotation ; retrait ≠ révocation).
ALTER TABLE "organization_signing_key" ADD COLUMN "retired_at" TIMESTAMP(3);

-- 3. Index simple pour les lookups par organisation (findFirst active key).
CREATE INDEX "organization_signing_key_organization_id_idx" ON "organization_signing_key"("organization_id");

-- 4. AU PLUS UNE clé active par organisation. "active" = ni retirée ni révoquée.
CREATE UNIQUE INDEX "organization_signing_key_one_active_per_org"
  ON "organization_signing_key"("organization_id")
  WHERE "retired_at" IS NULL AND "revoked_at" IS NULL;
