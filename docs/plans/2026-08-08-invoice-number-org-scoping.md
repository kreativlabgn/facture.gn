# Plan : Corriger l'unicité de `Invoice.number` (globale → par organisation)

## Contexte facture.gn
- Bounded context : Trust Context (Squad Trust) — modèle `Invoice`, émission (`InvoicesService.issue()`)
- Persona affecté : toute organisation qui émet une facture (Aissatou, Mamadou, Djénabou...) — actuellement **bloquant dès la 2ᵉ organisation active sur le système**, pas un edge case rare
- Données sensibles manipulées : aucune nouvelle donnée sensible — correction d'une contrainte structurelle sur la numérotation légale (OHADA Article 23)
- Impact réglementaire : direct — Article 23 OHADA exige une séquence **sans trou par entité**, ce que `InvoiceSequence` respecte déjà ; c'est la contrainte SQL sur `Invoice.number` qui viole l'invariant en le rendant global

## Problème (en 3 lignes max)

`Invoice.number String? @unique` (schema.prisma:222) est une contrainte unique **globale**, alors que la spec (ERD ligne 208 : "unique par org/année") et `InvoiceNumberingService` (séquence scopée par `organizationId`+`year`) attendent une unicité **par organisation**. Deux organisations différentes émettant chacune leur première facture de l'année produisent toutes deux `FG-2026-000001` → la 2ᵉ émission plante en 500 Prisma brut (`Unique constraint failed on the fields: (number)`), reproduit manuellement ce sprint.

## Solution retenue (en 5 lignes max)

Remplacer `number String? @unique` par une contrainte composite `@@unique([organizationId, number])` sur le modèle `Invoice`, migration Prisma dédiée. `InvoicesService.issue()` catch désormais une violation P2002 sur cette contrainte composite (même pattern que `OrganizationsService.create()` pour le conflit sur `nif`) et la traduit en `ConflictException` explicite plutôt qu'un 500 brut — filet de sécurité si `InvoiceNumberingService` produisait un jour un doublon sous concurrence extrême. Aucun autre fichier à toucher : aucun lookup par `number` seul dans le code (vérifié par grep).

## Alternatives écartées

- **Préfixer le numéro par un identifiant d'organisation dans la chaîne elle-même** (ex. `FG-{ORGSHORT}-2026-000001`) : écarté — casserait le format `FG-YYYY-NNNNNN` explicitement spécifié par l'ERD et le DAT §5.2 (séquentiel légal OHADA), qui ne prévoit aucun segment organisation dans `number` (contrairement à `certification_id` qui, lui, encode le NIF).
- **Garder l'unicité globale et changer `InvoiceNumberingService` pour générer un compteur global unique (partagé entre toutes les organisations)** : écarté — violerait directement Article 23 OHADA, qui exige que la séquence de CHAQUE entité commence à 1 et soit sans trou ; un compteur partagé mélangerait les séquences légales de plusieurs entreprises différentes.

## Découpage en tâches bite-sized (2–5 min chacune)

- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — remplacer `number String? @unique` par `number String?` (sans `@unique` seul) et ajouter `@@unique([organizationId, number])` sur le modèle `Invoice`
- [ ] Tâche 2 : générer la migration Prisma (`prisma migrate dev --name invoice_number_scoped_per_organization`) contre l'instance Postgres locale, vérifier le SQL généré (DROP de l'ancienne contrainte unique globale, CREATE de la contrainte composite)
- [ ] Tâche 3 : `apps/trust-api/src/invoices/invoices.service.ts` — dans `issue()`, catch la violation P2002 sur `(organization_id, number)` et lever `ConflictException` explicite (réutiliser le helper `isUniqueConstraintViolation` déjà présent dans `organizations.service.ts`, à extraire dans `apps/trust-api/src/common/` pour éviter la duplication)
- [ ] Tâche 4 : `apps/trust-api/src/common/prisma-errors.ts` (nouveau) — extraire `isUniqueConstraintViolation(error, field)` depuis `organizations.service.ts` vers ce fichier partagé, mettre à jour les deux appelants

## Tests à écrire AVANT le code

- [ ] Test 1 : `invoice-numbering.service.integration.spec.ts` (étendu) — deux organisations différentes émettent chacune leur première facture de l'année → toutes deux obtiennent `FG-2026-000001` sans erreur (test d'intégration Postgres réel, pas mocké — c'est une contrainte DB qu'on teste)
- [ ] Test 2 : même fichier — une même organisation ne peut pas se retrouver avec deux factures portant le même `number` (régression sur l'invariant existant, contrainte composite toujours effective au sein d'une organisation)
- [ ] Test 3 : `invoices.service.spec.ts` (étendu) — `issue()` traduit une violation P2002 simulée (mock Prisma) sur `(organization_id, number)` en `ConflictException`, jamais un 500 brut

## Critères de done

- [ ] Tous les tests verts (`pnpm turbo lint typecheck test`), y compris le test d'intégration Postgres réel (Test 1/2)
- [ ] Migration Prisma appliquée proprement sur l'instance de dev, `prisma migrate status` propre
- [ ] Vérification E2E réelle : reproduire exactement le scénario qui a planté ce sprint (deux organisations, chacune émet sa première facture de l'année) → les deux réussissent en HTTP réel
- [ ] Aucune régression sur les endpoints existants (`organizations`, `invoices`, `verify`)
- [ ] `dev-code-reviewer` passé sur le diff

## Risques identifiés & mitigations

- Risque 1 : la migration Prisma sur une base de dev contenant déjà des données pourrait échouer si des doublons `(organizationId, number)` existent déjà (peu probable vu l'invariant `InvoiceSequence`, mais possible avec les données de test résiduelles du sprint précédent) → mitigation : vérifier avant migration avec une requête SQL de contrôle des doublons potentiels
- Risque 2 : oubli d'un endroit qui lookup par `number` seul, cassé silencieusement par le changement de contrainte → mitigation : déjà vérifié par grep avant ce plan (aucun résultat), à revérifier après la Tâche 1 (le typage Prisma généré changerait de forme si un tel appel existait, donc le typecheck le détecterait)
- Risque 3 : extraction de `isUniqueConstraintViolation` vers un fichier partagé casse le comportement existant sur `organizations.service.ts` → mitigation : test existant `organizations.service.spec.ts` (conflit sur `nif`) doit rester vert sans modification

## Vérification bout-en-bout prévue

Reproduire exactement le scénario qui a fait planter le serveur ce sprint : deux organisations différentes (NIF différents), chacune crée et émet sa première facture de l'année via l'API HTTP réelle → les deux `POST /invoices/:id/issue` doivent réussir avec `number: "FG-2026-000001"` chacune, `GET /verify/:certificationId` doit distinguer correctement les deux malgré le `number` identique (recherche par `certificationId`, jamais par `number`).
