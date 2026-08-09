-- C15 : garantit au niveau base les deux invariants de cycle de vie proforma →
-- facture, au-delà des vérifications applicatives à un seul point d'écriture
-- chacune (même précédent que la contrainte fiscale ajoutée en C4).

-- Un proforma (ou un devis) ne peut jamais atteindre le statut "issued" — seule
-- une conversion (convertToInvoice) produit une facture réellement émissible.
ALTER TABLE "invoice"
ADD CONSTRAINT "invoice_issued_requires_invoice_type_check"
CHECK ("status" != 'issued' OR "document_type" = 'invoice');

-- convertedToInvoiceId ne doit jamais être posé que sur un proforma converti —
-- jamais sur une facture normale ou un devis.
ALTER TABLE "invoice"
ADD CONSTRAINT "invoice_conversion_requires_proforma_check"
CHECK ("converted_to_invoice_id" IS NULL OR "document_type" = 'proforma');
