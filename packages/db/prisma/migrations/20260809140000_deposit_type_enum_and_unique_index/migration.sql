-- C5 (revue de modèle de domaine) : deposit_type devient un enum plutôt qu'une
-- String brute, cohérent avec tous les autres champs discriminants de ce schema —
-- protège contre une valeur mal orthographiée qui échapperait silencieusement aux
-- filtres depositType="arrhes" déjà en place.
CREATE TYPE "DepositType" AS ENUM ('arrhes');

ALTER TABLE "payment"
ALTER COLUMN "deposit_type" TYPE "DepositType"
USING "deposit_type"::"DepositType";

-- Au plus une arrhes par facture, garanti au niveau base (pas seulement par la
-- garde applicative de PaymentsService.recordDepositPayment()) — même précédent
-- que les contraintes CHECK C4/C15 : protège contre un futur second chemin
-- d'écriture qui n'existe pas aujourd'hui mais que rien n'empêche structurellement.
CREATE UNIQUE INDEX "payment_one_arrhes_per_invoice"
ON "payment" ("invoice_id")
WHERE "deposit_type" = 'arrhes';
