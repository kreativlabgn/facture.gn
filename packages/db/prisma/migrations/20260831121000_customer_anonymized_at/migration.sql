-- Lot J2 (ADR-116) — horodatage d'anonymisation d'un client (L/2016/037).
-- La ligne customer est CONSERVÉE (intégrité des factures) ; seuls ses champs
-- PII sont effacés (tombstone) au moment de l'anonymisation. anonymized_at
-- marque la ligne comme GELÉE.
--
-- Index partiel : sert l'AUDIT (« lister les clients anonymisés d'une
-- organisation, avec leur date »). Le dédoublonnage (CustomersService.create /
-- importCustomers) filtre `anonymizedAt: null` (le cas fréquent) et s'appuie sur
-- `customer_phone_idx` existant — il n'utilise pas cet index.

ALTER TABLE "customer" ADD COLUMN "anonymized_at" TIMESTAMP(3);

CREATE INDEX "customer_anonymized_at_idx" ON "customer"("anonymized_at") WHERE "anonymized_at" IS NOT NULL;
