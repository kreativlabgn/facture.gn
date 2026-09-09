-- ADR-108 — dualité des régimes de saisie des lignes de facture (HT vs TTC).
--
-- Le parcours marchand (PWA, USSD, agent terrain, récurrent) capture des prix
-- unitaires TTC ; la passerelle PDP (ADR-107) reçoit des prix unitaires HORS
-- TAXES, standard des ERP tiers. Les deux cohabitent déjà dans invoice_line
-- depuis la mise en service du worker PDP : rien ne les distinguait, et le
-- rendu ligne à ligne intitulait « TTC » des montants HT.
--
-- CETTE MIGRATION NE TOUCHE AUCUN MONTANT. Elle ajoute un indicateur de
-- PROVENANCE. Les totaux d'une facture (total_ht, total_tva, total_ttc) sont
-- scellés par la certification Ed25519 : les recalculer, même « pour corriger »,
-- invaliderait des signatures déjà émises. Le correctif est donc entièrement
-- côté affichage, et c'est la seule forme qu'il pouvait prendre.
--
-- DDL écrit à la main, comme 20260909010000_pdp_raw_transaction : `prisma
-- migrate diff` exige une base d'ombre, indisponible ici (ni Postgres local ni
-- Docker au 2026-09-09). Le DDL suit à la lettre ce que Prisma 5.22 produit
-- pour cet enum et cette colonne.
--
-- ── RLS : RIEN À AJOUTER, ET C'EST VÉRIFIÉ, PAS SUPPOSÉ ──────────────────────
-- invoice_line est sous RLS depuis 20260829150000_enable_row_level_security
-- (ENABLE + FORCE + politique org_isolation, scopée via son invoice_id). Une
-- politique porte sur la LIGNE, jamais sur la liste des colonnes : la colonne
-- ajoutée ici est couverte par org_isolation dès sa création, sans DDL
-- supplémentaire. Le GRANT du rôle applicatif est également au niveau table
-- (GRANT ... ON TABLE), donc inchangé lui aussi.
--
-- La vérification en fin de fichier fige ce raisonnement : si un jour
-- invoice_line perdait FORCE ROW LEVEL SECURITY, cette migration refuserait de
-- s'appliquer plutôt que d'ajouter en silence une colonne à une table devenue
-- lisible par tout locataire.

-- CreateEnum
CREATE TYPE "SaisieRegime" AS ENUM ('TTC_FIRST', 'HT_FIRST');

-- AlterTable
-- DEFAULT 'TTC_FIRST' et NOT NULL : toutes les lignes existantes viennent du
-- parcours marchand, la valeur posée au remplissage est donc EXACTE pour
-- l'historique — jamais un bouche-trou. Les seules lignes HT antérieures à cette
-- migration sont celles qu'a écrites PdpConsolidationService ; elles sont
-- reprises explicitement plus bas.
ALTER TABLE "invoice_line" ADD COLUMN "saisie_regime" "SaisieRegime" NOT NULL DEFAULT 'TTC_FIRST';

-- ── Rattrapage des lignes déjà écrites par la passerelle PDP ─────────────────
--
-- Le worker PDP (ADR-107) est en service depuis le 2026-09-09 : les lignes qu'il
-- a créées portent des prix unitaires HT et viennent d'être marquées TTC_FIRST
-- par le DEFAULT ci-dessus. Sans cette reprise, ce sont précisément les factures
-- que l'ADR-108 veut corriger qui resteraient mal affichées.
--
-- Le critère est le LIEN pdp_raw_transaction.invoice_id, jamais
-- invoice.emission_channel = 'api' : ce canal est réservé « pour le futur (auth
-- par clé API, F15) » et pourrait servir demain à un chemin TTC. Le lien PDP,
-- lui, ne désigne que des documents entrés par la passerelle.
--
-- Aucune condition de date : le lien est exact quelle que soit l'ancienneté.
UPDATE "invoice_line"
SET "saisie_regime" = 'HT_FIRST'
WHERE "invoice_id" IN (
  SELECT "invoice_id" FROM "pdp_raw_transaction" WHERE "invoice_id" IS NOT NULL
);

-- ── Garde-fou d'étanchéité ──────────────────────────────────────────────────
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = '"invoice_line"'::regclass
      AND relrowsecurity
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'invoice_line n''est plus sous FORCE ROW LEVEL SECURITY — ADR-108 refuse d''y ajouter une colonne tant que l''isolation par organisation n''est pas rétablie';
  END IF;
END
$do$;
