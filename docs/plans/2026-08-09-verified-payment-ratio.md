# Plan : Taux de paiements vérifiés (E8, ADR-093)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), nouveau périmètre `organizations/` (endpoint) + `common/rbac/` (extension du guard)
- Persona affecté : owner ou admin d'une organisation, qui veut comprendre la part de ses encaissements réglée par lien de paiement plutôt qu'en cash, en vue d'un futur accès au crédit (Capital Layer, hors scope ici)
- Données sensibles manipulées : aucune nouvelle — dérivé de `Payment.method`, déjà en base
- Impact réglementaire : aucun — ADR-093 est explicite : affichage strictement informatif, jamais un gate de fonctionnalité, jamais exposé à un tiers externe au MVP

## Problème (en 3 lignes max)
ADR-093 avance au MVP un indicateur déjà envisagé pour le Capital Layer (V2) : le ratio paiements réglés par lien / total des encaissements. Aucun endpoint ne l'expose aujourd'hui, alors que la donnée sous-jacente (`Payment.method`) existe déjà intégralement.

## Solution retenue (en 5 lignes max)
Nouvelle route `GET /organizations/:id/trust-score`, réservée à `owner`/`admin` (backlog explicite). Le service calcule `verifiedAmount` (somme des `Payment.amount` où `method="payment_link"`) et `totalAmount` (somme de tous les `Payment.amount`, arrhes exclues — bucket financier distinct, C5), via `prisma.payment.aggregate()`. `ratio = totalAmount > 0 ? verifiedAmount/totalAmount : null` (jamais un faux 0% pour une organisation sans historique). **Découverte pendant l'investigation** : `RolesGuard.resolveOrganizationId()` ne sait résoudre `:id` QUE comme un identifiant de facture (`issue`/`void`/...) — aucune route `@Roles()` existante ne traite `:id` comme l'identifiant direct d'une organisation. Le guard doit être étendu (nouveau décorateur `@OrganizationIdSource("organization")`, défaut `"invoice"` pour ne rien casser) — extension anticipée par le propre commentaire du guard ("à généraliser si... d'autres formes de routes").

## Alternatives écartées
Résoudre l'organisation en devinant le type d'entité par tentative (chercher d'abord une facture, puis une organisation en fallback) — écartée : fragile (un échec de lookup facture pour une tout autre raison tomberait silencieusement dans le mauvais chemin), et invisible/non testable explicitement. Le décorateur explicite est le choix sûr, cohérent avec le pattern `@Roles()` déjà établi.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/common/rbac/organization-id-source.decorator.ts` (nouveau) — `OrganizationIdSource("invoice" | "organization")`, `SetMetadata`
- [ ] Tâche 2 : `apps/trust-api/src/common/rbac/roles.guard.ts` — lit la métadata (défaut `"invoice"`, rétrocompatible), résout `params.id` comme organisation directement si `"organization"` (404 explicite si introuvable, même pattern que le cas facture existant)
- [ ] Tâche 3 : `apps/trust-api/src/organizations/organizations.service.ts` — nouvelle méthode `getVerifiedPaymentRatio(organizationId)` : deux `aggregate()` (total hors arrhes, vérifié = `method="payment_link"`), retourne `{ totalAmount, verifiedAmount, ratio }`
- [ ] Tâche 4 : `apps/trust-api/src/organizations/organizations.controller.ts` — route `GET :id/trust-score`, `@Roles("owner","admin")` + `@OrganizationIdSource("organization")`

## Tests à écrire AVANT le code
- [ ] Test 1 (`roles.guard.spec.ts`) : sans le décorateur (défaut), `:id` continue d'être résolu comme une facture — non-régression explicite sur tous les tests existants (aucun ne doit changer)
- [ ] Test 2 (`roles.guard.spec.ts`) : avec `@OrganizationIdSource("organization")`, `:id` est résolu directement comme organisation (pas de lookup facture)
- [ ] Test 3 (`roles.guard.spec.ts`) : avec `"organization"`, une organisation introuvable → 404 explicite, jamais un 500 brut
- [ ] Test 4 (`organizations.service.spec.ts`) : ratio calculé correctement (ex. 300 000 vérifié / 500 000 total = 0.6)
- [ ] Test 5 (`organizations.service.spec.ts`) : aucun paiement du tout → `ratio: null`, jamais un faux `0`
- [ ] Test 6 (`organizations.service.spec.ts`) : tous les paiements vérifiés (100% payment_link) → `ratio: 1`
- [ ] Test 7 (`organizations.service.spec.ts`) : une arrhes (`depositType="arrhes"`) n'entre dans AUCUN des deux totaux — non-régression du principe C5 (bucket financier distinct)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante, en particulier `roles.guard.spec.ts` intégralement inchangé dans son comportement)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK — attention particulière requise sur la non-régression du guard partagé par TOUTES les routes `@Roles()` du repo
- security-reviewer : non nécessaire (aucune donnée sensible nouvelle, lecture seule sur des données déjà existantes)

## Risques identifiés & mitigations
- Risque 1 : casser silencieusement une route `@Roles()` existante en modifiant un composant partagé critique → mitigation : défaut `"invoice"` strictement rétrocompatible, suite complète relancée après le changement, test de non-régression dédié.
- Risque 2 : afficher un ratio trompeur pour une organisation sans historique → mitigation : `ratio: null` explicite plutôt qu'un 0% qui laisserait croire à un mauvais historique plutôt qu'à une absence de données.
