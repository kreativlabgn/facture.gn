-- eTax — état de télétransmission de la clôture fiscale (chantier 5, étape 3).
--
-- POURQUOI UN ÉTAT EN BASE ET PAS SEULEMENT UNE FILE
-- La file BullMQ est une mémoire VOLATILE : Redis vidé, cinq tentatives
-- épuisées, ou simplement Redis éteint au moment de la clôture, et le job
-- disparaît. Sans ces deux colonnes, un exercice pourrait n'être jamais déclaré
-- à la DGI sans que rien ne permette de s'en apercevoir. Avec elles, le
-- rattrapage tient dans une requête : les clôtures dont etax_submitted_at est
-- NULL sont exactement celles qui restent dues.
--
-- ELLES RENDENT AUSSI LE WORKER IDEMPOTENT. Un réessai après acquittement
-- partiel (eTax a bien reçu, la réponse s'est perdue en route) ne doit pas
-- redéclarer l'exercice : on ne retire pas une déclaration fiscale déjà
-- transmise. Le worker lit cet état avant d'envoyer et s'arrête s'il est posé.
--
-- PAS DE SECTION RLS ICI — aucune table créée. `fiscal_period_closing` fait
-- déjà partie du registre RLS (28 tables, 20260905120000 + 20260907010000) et
-- porte sa politique org_isolation ; ajouter des colonnes ne la change pas. Les
-- privilèges de facture_app sont accordés au niveau TABLE, jamais colonne par
-- colonne : les nouvelles colonnes sont couvertes sans GRANT supplémentaire.
--
-- Deux colonnes NULLABLES, sans valeur par défaut : les clôtures déjà en base
-- deviennent « non transmises », ce qui est exactement leur état réel — aucune
-- n'a jamais été envoyée à eTax.

-- AlterTable
ALTER TABLE "fiscal_period_closing" ADD COLUMN     "etax_submission_ref" TEXT,
ADD COLUMN     "etax_submitted_at" TIMESTAMP(3);
