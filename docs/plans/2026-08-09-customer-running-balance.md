# Plan : Suivre le solde d'un client à crédit récurrent (C6)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — NOUVELLE entité (`Customer`), extension d'un DTO déjà testé (`create-invoice.dto.ts`)
- Persona affecté : organisation vendant à crédit à des clients récurrents (ex. Aissatou/boutique fournissant plusieurs commerces partenaires, Ibrahima/livreur avec comptes clients réguliers) — aucun bullet backlog ne nomme un persona précis, mais ADR-039 est la seule référence
- Données sensibles manipulées : PII client (nom, téléphone, NIF) — protection des données (Loi L/2016/037/AN), pas de NIN ni de secret de paiement
- Impact réglementaire : aucun direct (relevé "jamais certifié" — ADR-039 explicite, donc hors du périmètre de certification Ed25519)

## Investigation préalable
Backlog : "C6 — Suivre le solde d'un client à crédit récurrent `[SHOULD]`" — Réf ADR-039, aucun bullet. ADR-039 (texte exact) : *"Décision : credit_limit/running_balance (calculé sur amount_due). account_statement sans hash."*

**Découverte structurante** : `Invoice.customerId` (schema.prisma:309) existe déjà comme `String?` — mais AUCUN modèle `Customer` n'existe dans tout le schema (grep confirmé), et AUCUN chemin applicatif ne l'écrit jamais (grep confirmé sur `apps/trust-api/src` : seul `payments.service.ts` le LIT, pour le regroupement de détection d'anomalie cash G1 — jamais un create-invoice.dto.ts qui l'accepterait). Champ scaffoldé mais totalement mort, des deux côtés (écriture ET modélisation).

ERD-facture-gn.md §2.5 (`CUSTOMER`, lignes 360-373) donne la définition complète : `id, organization_id, name, phone (nullable), nif (nullable), is_public_entity (bool, défaut false, V2), credit_limit (bigint nullable), running_balance (bigint, "calculé sur amount_due"), public_buyer_account_id (V2), possible_duplicate_of (nullable)`.

**Décisions de scope explicites** :
1. `is_public_entity` et `public_buyer_account_id` — exclus, marqués **(V2)** explicitement dans l'ERD, même discipline que `ProfessionalPractice`/F4 (jamais construire un champ marqué V2 dans une story MVP).
2. `possible_duplicate_of` — exclu, aucun signal dans le texte C6 ni ADR-039 pour une détection de doublons ; fonctionnalité distincte (dédoublonnage), aucun mécanisme de détection scaffoldé ailleurs, hors scope.
3. `running_balance` — PAS une colonne stockée. L'ERD le décrit comme "calculé sur amount_due" (une valeur dérivée, jamais persistée) — cohérent avec la discipline déjà appliquée dans ce repo de ne jamais dupliquer une valeur dérivable (aucun autre agrégat financier de ce repo n'est stocké en dur). Calculé à la demande : `SUM(Invoice.amountDue)` sur toutes les factures actives (`issued`/`partially_paid`) du client, au moment de la lecture.
4. `credit_limit` — champ simple, nullable, jamais un défaut serveur inventé (même discipline que `registrationNumber`/`email` sur `ProfessionalPractice`, F4).
5. `account_statement` (ADR-039, "sans hash") — HORS SCOPE de cette story précise : C6 porte sur le SOLDE (running_balance), pas sur le document de relevé complet (liste détaillée des mouvements). Aucun bullet ne l'exige explicitement pour C6 ; un relevé complet serait une extension naturelle future (comparable à la façon dont F9/FEC a suivi la lecture de facture C10) si demandé.
6. `Invoice.customerId` reste `String?` optionnel ("nullable pour anonyme", ERD) — devient une vraie relation Prisma (`Customer?`) avec contrainte FK, mais SANS rendre le champ obligatoire nulle part : aucune facture existante n'a de `customerId` renseigné (confirmé, jamais écrit), donc la migration ajoute la contrainte FK sans risque de données orphelines.

## Problème (en 3 lignes max)
Une organisation qui vend à crédit au même client plusieurs fois n'a aucun moyen de savoir combien ce client lui doit au total — `Invoice.customerId` existe mais ne pointe vers rien, et aucun agrégat cross-facture n'existe dans ce repo.

## Solution retenue (en 5 lignes max)
Nouveau modèle `Customer` (id, organizationId, name, phone?, nif?, creditLimit?). `POST /customers` (mirroir exact de `practices.controller.ts`/F4 : n'importe quel membre authentifié de l'organisation crée un client). `create-invoice.dto.ts` accepte un `customerId` optionnel (validé : appartient à la même organisation). `GET /customers/:id` retourne le client + `runningBalance` calculé à la volée (`SUM(amountDue)` sur ses factures `issued`/`partially_paid`).

## Alternatives écartées
Stocker `runningBalance` comme colonne persistée mise à jour à chaque paiement/émission — écartée : introduirait une source de vérité dupliquée avec un risque de drift (aucun précédent de ce genre dans ce repo, `amountDue` lui-même n'a JAMAIS de doublon stocké ailleurs), alors qu'un `SUM()` à la demande sur un nombre de factures par client réaliste (dizaines, pas milliers) reste largement dans le budget de performance sans index supplémentaire exotique.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — modèle `Customer` (id, organizationId FK, name, phone?, nif?, creditLimit?, createdAt), `Invoice.customerId` devient une vraie relation `Customer?` (FK), migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/customers/dto/create-customer.dto.ts` — name requis, phone/nif/creditLimit optionnels
- [ ] Tâche 3 : `apps/trust-api/src/customers/customers.service.ts` — `create(organizationId, dto)`, `findOneWithBalance(customerId)` (agrégat `SUM(amountDue)`)
- [ ] Tâche 4 : `apps/trust-api/src/customers/customers.controller.ts` + `customers.module.ts` — `POST /customers` (`@Roles` mêmes rôles que création facture), `GET /customers/:id`
- [ ] Tâche 5 : `apps/trust-api/src/invoices/dto/create-invoice.dto.ts` — `customerId: z.string().uuid().optional()`
- [ ] Tâche 6 : `apps/trust-api/src/invoices/invoices.service.ts:createDraft()` — valide que `customerId` (si fourni) appartient à `organizationId`, sinon `ConflictException`

## Tests à écrire AVANT le code
- [ ] Test 1 (`customers.service.spec.ts`) : `create()` crée un client avec les champs fournis, `creditLimit` absent → `null` (jamais un défaut inventé)
- [ ] Test 2 : `findOneWithBalance()` retourne `runningBalance = 0` pour un client sans facture
- [ ] Test 3 : `findOneWithBalance()` agrège `amountDue` sur PLUSIEURS factures `issued`/`partially_paid` du même client, ignore les factures `paid`/`voided`/`draft`
- [ ] Test 4 (`invoices.service.spec.ts`) : `createDraft()` avec `customerId` d'un client d'une AUTRE organisation → rejeté
- [ ] Test 5 : `createDraft()` avec `customerId` valide (même organisation) → facture créée avec ce `customerId`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Migration Prisma appliquée (`prisma migrate deploy` + `prisma generate` + `turbo build --filter=@facture-gn/db`)
- code-reviewer OK
- domain-model-reviewer recommandé (nouveau modèle de domaine, `Customer`)

## Risques identifiés & mitigations
- Risque 1 : `Invoice.customerId` devient une relation FK stricte — un `customerId` invalide (organisation différente ou inexistant) pourrait échouer silencieusement côté Prisma (contrainte FK brute, erreur peu lisible) → mitigation : validation explicite côté service AVANT la création, `ConflictException` avec message actionnable.
- Risque 2 : agrégat `SUM(amountDue)` sur un grand nombre de factures pourrait devenir lent à très grande échelle → mitigation : accepté pour le MVP (10 000 orgs cible, pas des millions de factures par client), index déjà existant sur `Invoice.customerId` du fait de la FK Prisma.
