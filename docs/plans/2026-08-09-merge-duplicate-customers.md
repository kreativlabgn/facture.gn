# Plan : Fusionner des clients dupliqués (E4)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension du module `customers/` créé cette session (C6)
- Persona affecté : admin/owner d'organisation qui a identifié deux fiches client comme étant la même personne/entité (ex. créée deux fois par erreur, une fois par un caissier, une fois par un agent terrain)
- Données sensibles manipulées : PII client (nom, téléphone, NIF) — même classe que C6, pas de nouvelle catégorie
- Impact réglementaire : aucun direct, mais motivé par la propreté de l'historique de facturation (comptabilité)

## Investigation préalable
Backlog (texte exact) : *"E4 — Fusionner des clients dupliqués `[SHOULD]`. En tant qu'admin ou owner, je veux fusionner deux fiches client identifiées comme doublons, afin de garder un historique de facturation propre. - Permission customer:merge_duplicate — admin/owner uniquement, jamais cashier ni field_agent. - Distinct de E3 : E3 prévient les doublons en offline, E4 résout ceux déjà créés. Réf : ADR-038, ADR-083."*

ADR-038 (texte exact) : *"Dédoublonnage : jamais de fusion automatique. Décision : possible_duplicate_of, résolution manuelle."*

**Découverte structurante** : `Customer.possible_duplicate_of` (ERD §2.5, ligne 373) a été explicitement EXCLU du scope de C6 (mergé cette session) avec la justification écrite *"aucun signal backlog pour la dédup"* — E4 est exactement ce signal, découvert maintenant. Le champ n'existe PAS encore dans `schema.prisma` (C6 ne l'a pas scaffoldé) — première apparition dans cette story.

**Décision de scope sur ADR-083** : ADR-083 ("Permissions dédiées pour les opérations sensibles sur CUSTOMER") introduit un catalogue de permissions granulaire (`customer:merge_duplicate`, `customer:manage_credit_limit`, `customer:flag_public_entity`) explicitement marqué **"scope V1"** dans son propre texte (*"Catalogue de permissions passe de 61 (MVP) à 64 en V1"*) — ce catalogue formel n'existe nulle part dans ce repo (aucune infrastructure de type `Permission`/`PermissionCatalog`, uniquement `@Roles()` + `OrganizationRole`). Le bullet E4 exige seulement *"admin/owner uniquement, jamais cashier ni field_agent"* — satisfiable intégralement avec `@Roles("owner","admin")`, le mécanisme RBAC déjà en place, sans construire de catalogue de permissions formel. Le "nom" `customer:merge_duplicate` reste un identifiant conceptuel dans l'ADR, pas une exigence d'implémentation littérale (même lecture déjà appliquée pour d'autres actions nommées par ADR dans ce repo, ex. B2/verify-dgi).

**Décision de scope sur le mécanisme de fusion** : ADR-038 dit "jamais de fusion automatique, résolution manuelle" — l'ACTE de fusion demandé ici EST la résolution manuelle par un humain (admin/owner choisit explicitement deux IDs à fusionner), pas une détection automatique de doublons à construire (E3, story distincte, hors scope). `possible_duplicate_of` est scaffoldé comme un simple pointeur informatif (jamais un flag qui déclenche quoi que ce soit automatiquement) — l'endpoint de fusion accepte n'importe quelle paire de `customerId` de la même organisation, que `possible_duplicate_of` ait été renseigné ou non (E3, qui alimenterait ce champ automatiquement en offline, est une story distincte et hors scope).

**Décision de scope sur le résultat de la fusion** : toutes les factures (`Invoice.customerId`) de la fiche "doublon" sont réassignées à la fiche "canonique" (`$transaction` atomique), PUIS la fiche doublon est supprimée définitivement — aucun pattern de soft-delete (`deletedAt`/`mergedAt`/`isActive`) n'existe nulle part dans ce repo, une suppression après réassignation sûre (zéro facture orpheline au moment de la suppression, contrainte FK déjà en place) est cohérente avec l'objectif énoncé ("garder un historique de facturation PROPRE") sans inventer un nouveau pattern de statut.

## Problème (en 3 lignes max)
Deux fiches client créées par erreur pour la même personne fragmentent son historique de facturation (deux soldes distincts au lieu d'un) sans qu'aucun mécanisme ne permette de les consolider.

## Solution retenue (en 5 lignes max)
`POST /customers/:id/merge` (`:id` = fiche canonique) — body `{duplicateCustomerId}`. Valide que les deux clients appartiennent à la même organisation et sont distincts, réassigne en une transaction toutes les factures du doublon vers le canonique (`updateMany`), puis supprime la fiche doublon. `@Roles("owner","admin")`, `@OrganizationIdSource("customer")` (déjà en place, C6).

## Alternatives écartées
Construire le catalogue de permissions formel d'ADR-083 (`Permission`/`PermissionCatalog`, rôle `approver`) — écartée, explicitement "scope V1" par le texte même de l'ADR, disproportionné pour cette story dont le bullet ne demande qu'une restriction `admin/owner` déjà satisfiable par `@Roles()`. Soft-delete du doublon plutôt que suppression — écartée, aucun précédent de ce pattern dans ce repo, complexifierait sans bénéfice demandé par le backlog.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — `Customer.possibleDuplicateOf String? @map("possible_duplicate_of")` + relation auto-référentielle, migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/customers/dto/merge-customer.dto.ts` — `duplicateCustomerId: z.string().uuid()`
- [ ] Tâche 3 : `apps/trust-api/src/customers/customers.service.ts` — `merge(canonicalCustomerId, duplicateCustomerId, organizationId)`
- [ ] Tâche 4 : `apps/trust-api/src/customers/customers.controller.ts` — `POST :id/merge`, `@Roles("owner","admin")`, `@OrganizationIdSource("customer")`

## Tests à écrire AVANT le code
- [ ] Test 1 (`customers.service.spec.ts`) : réassigne toutes les factures du doublon vers le canonique
- [ ] Test 2 : supprime la fiche doublon après réassignation
- [ ] Test 3 : rejette si le doublon appartient à une AUTRE organisation
- [ ] Test 4 : rejette si canonicalCustomerId === duplicateCustomerId (fusion avec soi-même)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Migration Prisma appliquée
- code-reviewer OK
- domain-model-reviewer recommandé (relation auto-référentielle nouvelle)

## Risques identifiés & mitigations
- Risque 1 : suppression du doublon AVANT réassignation complète des factures → violation de contrainte FK ou perte de facture → mitigation : `$transaction` atomique (réassignation puis suppression dans le même bloc, rollback complet si l'une des deux étapes échoue).
- Risque 2 : fusionner deux clients de deux organisations différentes (fuite cross-tenant) → mitigation : validation explicite `organizationId` identique AVANT toute mutation, `ConflictException` sinon (même discipline que la validation `customerId` de `createDraft()`, C6).
