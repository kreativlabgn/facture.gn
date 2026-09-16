-- Catalogue produit/service (E10, plan docs/plans/2026-09-16-catalogue-produits-services.md)
--
-- Quatre champs métier posés sur product : description (descriptif court,
-- borné à la couche API — Zod max 500, pas de longueur en base, cohérent
-- avec le reste de ce schéma qui ne déclare aucun @db.VarChar), sale_price
-- (prix de vente, centimes GNF — même convention que cost_price/
-- invoice_line.unit_price, nullable car une partie des services PME sont
-- "sur devis"), is_active (retrait du catalogue affiché sans suppression —
-- product reste une FK historique depuis invoice_line, onDelete: SetNull) et
-- type (ProductType, manquant depuis la création du modèle en 20260818190000
-- — product_stock n'a de sens que pour un produit physique, jamais un
-- service).
--
-- DDL écrit à la main, comme 20260909020000_saisie_regime : pas de base
-- d'ombre disponible sur ce poste pour `prisma migrate diff`.
--
-- ── RLS : RIEN À AJOUTER ──────────────────────────────────────────────────
-- "product" est sous ENABLE + FORCE ROW LEVEL SECURITY depuis
-- 20260829150000_enable_row_level_security / 20260907020000_rls_force_row_
-- level_security. Une politique porte sur la LIGNE, jamais sur la liste des
-- colonnes : les colonnes ajoutées ici sont couvertes par org_isolation dès
-- leur création, sans DDL supplémentaire (même raisonnement déjà vérifié
-- pour invoice_line.saisie_regime, 20260909020000). Le GRANT du rôle
-- applicatif est également au niveau table (GRANT ... ON TABLE), donc
-- inchangé lui aussi — aucune nouvelle table ici.

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('product', 'service');

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "description" TEXT,
ADD COLUMN     "sale_price" BIGINT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
-- DEFAULT temporaire pour satisfaire les lignes déjà existantes (tout le
-- catalogue créé jusqu'ici l'a été implicitement comme un produit physique —
-- seul sens disponible avant ce chantier, et le seul cohérent avec
-- product_stock déjà en base pour certaines de ces lignes) ; retiré aussitôt
-- après car le schéma Prisma ne déclare aucun @default sur ce champ — chaque
-- écriture future doit fournir "type" explicitement (createProductSchema,
-- champ obligatoire à la création). Même séquence que
-- 20260809210000_add_mandate_initiated_by (mandate.initiated_by).
ALTER TABLE "product" ADD COLUMN     "type" "ProductType" NOT NULL DEFAULT 'product';
ALTER TABLE "product" ALTER COLUMN "type" DROP DEFAULT;
