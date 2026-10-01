-- *620# — interception flash suggestive, recherche composite téléphone+montant,
-- encaissement cash (plan 2026-09-16-ussd-flash-recherche-encaissement-cash.md).
--
-- Capacité 1 (flash) — horodatage de suggestion, auto-borné par la fenêtre
-- d'éligibilité (issuedAt < 30 min) : aucune purge séparée requise, contrairement
-- à ussd_session.expires_at.
ALTER TABLE "invoice" ADD COLUMN "flash_suggested_at" TIMESTAMP(3);

-- Jointure cross-organisation Customer.phone -> Invoice.customer_id (capacité 1) :
-- aucun index n'existait sur invoice.customer_id jusqu'ici.
CREATE INDEX "invoice_customer_id_issued_at_idx" ON "invoice" ("customer_id", "issued_at");

-- Recherche composite téléphone + montant, scopée organisation (capacité 2).
CREATE INDEX "invoice_organization_id_total_ttc_issued_at_idx"
  ON "invoice" ("organization_id", "total_ttc", "issued_at");

-- Canal de collecte (capacité 3) — réutilise l'enum EmissionChannel existant,
-- nullable, SANS DÉFAUT (NULL = inconnu/legacy, jamais migré rétroactivement —
-- même discipline qu'invoice.signing_key_id).
ALTER TABLE "payment" ADD COLUMN "collection_channel" "EmissionChannel";
