-- C4 : garantit total_ht + total_tva = total_ttc au niveau base, indépendamment
-- du chemin de code qui écrit la ligne (protège contre updateDraft(), une future
-- migration manuelle, ou tout futur chemin d'écriture non prévu ici).

-- Backfill : lignes créées avant C4 (total_ht/total_tva jamais calculés, toujours
-- à 0 par défaut) — réconciliées sur la convention TTC-first déjà établie par ce
-- projet (total_ht = total_ttc, total_tva = 0), cohérent avec le comportement d'un
-- régime sans TVA.
UPDATE "invoice"
SET "total_ht" = "total_ttc", "total_tva" = 0
WHERE "total_ht" + "total_tva" != "total_ttc";

ALTER TABLE "invoice"
ADD CONSTRAINT "invoice_tax_invariant_check"
CHECK ("total_ht" + "total_tva" = "total_ttc");
