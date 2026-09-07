-- ADR-106 — Starter Plus, 6e palier commercial.
--
-- Comble le saut tarifaire entre Starter (2 succursales / 4 collaborateurs) et
-- Pro (illimité / 10). Le manque était documenté depuis H1 dans
-- plan-features-grid.ts : « Starter Plus (ADR-106) n'existe pas dans l'enum
-- CommercialTier (5 paliers) — gap hors scope ».
--
-- ADD VALUE plutôt que le DROP TYPE / CREATE TYPE que produit `migrate diff` :
-- recréer le type détacherait la colonne organization.commercial_tier de toutes
-- les lignes existantes. Même écriture manuelle que les migrations
-- 20260817140000_add_auditor_role et 20260818120000_add_credit_limit_approval.
--
-- BEFORE 'pro' : l'ordre de l'enum n'est utilisé par aucune requête aujourd'hui
-- (TIER_ORDER vit côté TypeScript), mais un ORDER BY sur la colonne doit
-- refléter la progression commerciale, pas l'ordre d'écriture des migrations.
--
-- Aucune organisation n'est déplacée : le palier est simplement disponible.

ALTER TYPE "CommercialTier" ADD VALUE 'starter_plus' BEFORE 'pro';
