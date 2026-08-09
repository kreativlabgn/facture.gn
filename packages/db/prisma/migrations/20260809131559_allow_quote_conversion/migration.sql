-- C16 : élargit l'invariant DB posé par C15 pour autoriser aussi la conversion
-- d'un devis (document_type='quote'), au même titre qu'un proforma — ADR-064 ne
-- prévoit aucune différence de traitement à la conversion elle-même entre les
-- deux sous-types de draft. Trouvé par un test E2E réel (500 brut en base avant
-- ce correctif) : la garde applicative de convertToInvoice() avait bien été
-- élargie, mais cette contrainte DB, ajoutée en C15, ne l'avait pas été.
ALTER TABLE "invoice"
DROP CONSTRAINT "invoice_conversion_requires_proforma_check";

ALTER TABLE "invoice"
ADD CONSTRAINT "invoice_conversion_requires_proforma_check"
CHECK ("converted_to_invoice_id" IS NULL OR "document_type" IN ('proforma', 'quote'));
