-- Transmission unitaire des factures au guichet e-TVA (LFI 2025).
--
-- Jusqu'ici la télétransmission était PÉRIODIQUE : une déclaration de TVA par
-- exercice, à la clôture (20260907050000). La loi de finances 2025 impose en
-- plus la transmission FACTURE PAR FACTURE, au moment de l'émission. Les deux
-- coexistent — ce ne sont pas les mêmes obligations, et l'une ne remplace pas
-- l'autre.
--
-- etax_status NULLABLE, SANS DÉFAUT, et c'est délibéré : null signifie « hors
-- périmètre », ce qui est le cas de tout brouillon et de toute facture émise
-- pendant que ETAX_ENABLED vaut false. Un défaut 'pending' aurait présenté
-- comme « en attente de la DGI » des dizaines de milliers de lignes que
-- personne n'a jamais mises en file — et rendu tout tableau de rattrapage faux
-- dès la première migration.
--
-- Aucune rétro-transmission des factures déjà émises : une facture certifiée ne
-- se retouche pas, et déclarer aujourd'hui un exercice passé n'est pas une
-- décision technique.
--
-- Pas de politique RLS à ajouter : ces colonnes vivent sur `invoice`, déjà au
-- registre depuis l'étape 1 du déploiement RLS.

-- CreateEnum
CREATE TYPE "EtaxTransmissionStatus" AS ENUM ('pending', 'transmitted', 'failed');

-- AlterEnum
-- Deux ADD VALUE plutôt qu'un DROP/CREATE du type : recréer "InvoiceEventType"
-- détacherait invoice_event.type, c'est-à-dire le journal WORM lui-même.
-- Postgres 16 accepte ADD VALUE dans une transaction tant que la nouvelle
-- valeur n'y est pas UTILISÉE — ce qui n'est pas le cas ici.
ALTER TYPE "InvoiceEventType" ADD VALUE 'etax_transmitted';
ALTER TYPE "InvoiceEventType" ADD VALUE 'etax_transmission_failed';

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "etax_receipt_number" TEXT,
ADD COLUMN     "etax_status" "EtaxTransmissionStatus",
ADD COLUMN     "etax_transmitted_at" TIMESTAMP(3);

-- Rattrapage : retrouver les factures qu'il faut retransmettre. L'index est
-- PARTIEL — les lignes hors périmètre (etax_status NULL) sont l'immense
-- majorité et n'ont aucune raison de peser dessus.
CREATE INDEX "invoice_etax_status_idx" ON "invoice" ("organization_id", "etax_status")
  WHERE "etax_status" IS NOT NULL;
