-- OCR multicanal — WhatsApp (texte), étape 2, plan
-- docs/plans/2026-09-16-ocr-multicanal-vocal-whatsapp.md. Extension ADDITIVE
-- de ocr_document, à la suite de 20260916150000_ocr_multicanal_whatsapp_audio.
--
-- customer_phone : le numéro de l'expéditeur WhatsApp (msisdn), posé
-- uniquement pour WHATSAPP_TEXT/WHATSAPP_VOICE. Repli de résolution client
-- (OcrVisionService.traiter(), via CustomersService.resolveByPhone()) quand
-- l'extraction ne déclare aucun client — jamais un champ `buyerPhone` dans le
-- contrat Zod ocrExtractionSchema (contrainte fondatrice inchangée). Pas
-- d'index/contrainte unique : plusieurs documents du même expéditeur sur la
-- même heure sont attendus (throttle applicatif, pas une clé d'idempotence —
-- whatsapp_message_id porte déjà celle-ci).
--
-- RLS : RIEN À AJOUTER — même raisonnement que 20260916150000 : une colonne
-- de plus sur ocr_document (déjà sous ENABLE + FORCE ROW LEVEL SECURITY)
-- ne change rien à une politique qui porte sur la ligne, pas sur la liste des
-- colonnes.

ALTER TABLE "ocr_document" ADD COLUMN "customer_phone" TEXT;
