-- APIP / eTax — unicité globale du RCCM et du numéro eTax (chantier 5).
--
-- POURQUOI DEUX INDEX UNIQUES ET PAS UNE VÉRIFICATION APPLICATIVE
-- L'onboarding depuis SYNERGUI-SAFIG 2 est un webhook : il est redélivré
-- (ADR-016), et rien ne garantit qu'il ne le soit pas en parallèle. Un
-- `findFirst` suivi d'un `create` laisse une fenêtre entre les deux ; sous
-- redélivrance concurrente, elle produit DEUX organisations pour la même
-- entreprise — chacune avec sa séquence de factures et sa chaîne de
-- certification. C'est irréparable a posteriori : on ne peut pas fusionner deux
-- chaînes de hash. La contrainte est donc le garde-fou réel, la lecture
-- applicative n'est que le chemin nominal.
--
-- NULL RESTE MULTIPLE — Postgres n'applique pas l'unicité aux NULL, donc les
-- organisations self-service sans identifiant fiscal (B4, ADR-035) continuent
-- de coexister sans conflit. Même propriété que organization.nif, déjà @unique.
--
-- PAS DE SECTION RLS ICI — aucune table créée, aucune relation nouvelle :
-- `organization` porte déjà sa politique org_isolation (registre RLS,
-- 20260905120000 + 20260907010000). Un index n'a pas de politique propre.
--
-- Vérifié avant application sur la base de dev : 0 doublon sur rccm (0 valeur
-- renseignée) et sur etax_number (1 valeur renseignée) — l'index se construit
-- sans rejet.

-- CreateIndex
CREATE UNIQUE INDEX "organization_etax_number_key" ON "organization"("etax_number");

-- CreateIndex
CREATE UNIQUE INDEX "organization_rccm_key" ON "organization"("rccm");
