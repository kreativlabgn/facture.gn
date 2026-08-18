# Plan : E9 — Importer mes clients en masse

## Contexte projet
- Module : Trust Context — `apps/trust-api/src/customers`
- Persona affecté : grossiste imposant facture.gn à son réseau de boutiques (persona ADR-100), ou toute PME onboardant un réseau de clients existant. Même trio de rôles que `create()` (owner/admin/accountant_internal/cashier/field_agent) — "aucune permission nouvelle" (Backlog E9).
- Données sensibles manipulées : téléphones clients (PII légère), montants de limite de crédit — même niveau que la création unitaire existante, aucune donnée nouvelle.
- Impact réglementaire : aucun cadre spécifique nouveau. ADR-100 signale un risque réglementaire (R-16) mais explicitement scopé aux points 3/4 (crédit privé), jamais à l'import lui-même (point 1, "intégralement couvert par l'existant").

## Clarifications
- Q: Fichier CSV brut (parsing serveur) ou tableau JSON de lignes déjà structurées ? → R: **Tableau JSON**. Le parsing CSV se fait côté PWA (hors scope). Évite une nouvelle dépendance serveur et un pattern multipart inexistant dans ce repo.
- Q: `possibleDuplicateOf` (E4) contient-il déjà une logique de détection réutilisable ? → R: **Non** — c'est un champ de schéma jamais renseigné par aucun code actuel (`merge()` d'E4 consomme un id fourni manuellement, il ne détecte rien). La détection par téléphone est entièrement nouvelle dans cette story ; seul le CHAMP est réutilisé.
- Q: Une ligne invalide (téléphone mal formé, nom vide) doit-elle rejeter tout le lot ou seulement cette ligne ? → R: **Seulement cette ligne** (partiel, ligne par ligne). Rejeter 300 lignes pour 1 typo contredit l'intention même de la story ("onboarder en quelques jours" vs une fiche à la fois). Déviation assumée de la convention du repo (chaque DTO existant utilise `ZodValidationPipe` qui rejette tout le body en bloc) — voir "Alternatives écartées".
- Q: Une ligne détectée comme doublon (téléphone déjà utilisé) est-elle créée quand même ou bloquée ? → R: **Créée quand même**, avec `possibleDuplicateOf` pointant vers le client existant qui matche — jamais de fusion automatique (même philosophie qu'E4 : "jamais de fusion automatique, résolution manuelle"). Jamais de perte silencieuse de donnée client pendant un import.
- Q: Le dédoublonnage regarde-t-il seulement les clients déjà en base, ou aussi les autres lignes du même lot ? → R: **Les deux** — une ligne peut matcher un client déjà en base OU une ligne précédente du même lot (même téléphone répété deux fois dans le CSV).
- Q: Taille maximale d'un lot ? → R: Aucune valeur spécifiée par le Backlog/ADR-100 (qui cite "300" comme exemple, pas une limite). Défaut retenu : **500 lignes par requête**, en constante `MAX_IMPORT_BATCH_SIZE`, ajustable en un point unique.

## Problème (en 3 lignes max)
Un grossiste (ou toute PME) qui doit enregistrer plusieurs centaines de clients ne peut aujourd'hui le faire qu'un par un via `POST /customers` — inutilisable pour onboarder un réseau de boutiques en une fois (ADR-100, gap explicitement signalé).

## Solution retenue (en 5 lignes max)
Un endpoint `POST /customers/import` accepte un tableau de lignes (même trio de rôles que `create()`), plafonné à 500 lignes. Chaque ligne est validée et traitée indépendamment (pas de transaction globale) : une ligne invalide devient une entrée `error` sans bloquer les autres. Une ligne dont le téléphone matche un client déjà en base OU une ligne précédente du même lot est créée avec `possibleDuplicateOf` renseigné, jamais fusionnée automatiquement. La réponse liste le résultat par ligne (créé / doublon détecté / erreur).

## Alternatives écartées
- **Upload de fichier CSV brut, parsé côté serveur** — écartée : nouvelle dépendance + nouveau pattern multipart absents de ce repo, pour un gain qui revient au client (la PWA peut déjà parser un CSV nativement).
- **Rejeter tout le lot si une seule ligne est invalide** (cohérent avec `ZodValidationPipe` partout ailleurs) — écartée : contredit la valeur même de la story. Le DTO externe reste strict sur la FORME (tableau, taille max) ; le contenu de chaque ligne est validé ligne par ligne dans le service via `safeParse`, jamais par la pipe globale.
- **Bloquer la création d'une ligne détectée comme doublon** — écartée : risque de perte de donnée cliente pendant un import de masse, et incohérent avec la philosophie déjà actée par E4 (résolution manuelle uniquement, jamais automatique).
- **Dédoublonnage par NIF en plus du téléphone** — écartée : hors scope, le Backlog ne mentionne que le téléphone.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : `apps/trust-api/src/customers/dto/import-customers.dto.ts` — `importCustomerRowSchema` (mêmes champs que `createCustomerSchema` moins `organizationId`) + `importCustomersSchema` ({ organizationId, customers: array souple, `.min(1).max(500)` })
- [ ] [P] Tâche 2 : `apps/trust-api/src/customers/import-customers.constants.ts` — `MAX_IMPORT_BATCH_SIZE = 500`
- [ ] Tâche 3 : `customers.service.ts` — `importCustomers(organizationId, rows)` : boucle séquentielle, `safeParse` par ligne, recherche de doublon (base + lot en cours), `customer.create()`, agrégation des résultats
- [ ] Tâche 4 : `customers.controller.ts` — `POST /customers/import` (`@Roles("owner","admin","accountant_internal","cashier","field_agent")`, pas de `@OrganizationIdSource` — organizationId vient du body, branche création déjà couverte par `RolesGuard`)

## Tests à écrire AVANT le code
- [ ] `customers.service.spec.ts` : lot valide sans doublon → tous créés, `possibleDuplicateOf` null partout
- [ ] `customers.service.spec.ts` : une ligne au téléphone déjà utilisé par un client EXISTANT de l'organisation → créée quand même, `possibleDuplicateOf` = id du client existant
- [ ] `customers.service.spec.ts` : deux lignes du même lot avec le même téléphone → la seconde créée avec `possibleDuplicateOf` = id de la première (créée dans ce même appel)
- [ ] `customers.service.spec.ts` : une ligne avec `name` vide → entrée `error` pour cette ligne, les autres lignes valides du lot sont créées normalement
- [ ] `customers.service.spec.ts` : une ligne avec téléphone mal formé → entrée `error`, message actionnable, autres lignes non affectées
- [ ] `customers.service.spec.ts` : lot vide (`customers: []`) → rejeté par le DTO externe (`min(1)`), jamais atteint par le service
- [ ] `import-customers.dto.spec.ts` : rejette un lot de plus de 500 lignes ; accepte un lot de exactement 500 ; rejette un lot vide
- [ ] `roles.guard.spec.ts` : non-régression — aucune modification de `RolesGuard` requise pour cette story (organizationId résolu depuis le body, branche déjà testée)

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` OK si le format de réponse par ligne introduit un type de statut à valeur ajoutée (`created`/`error`) — vérifier qu'il n'est pas juste une string libre

## Risques identifiés & mitigations
- Risque 1 : 300+ créations séquentielles dans une seule requête HTTP → temps de réponse long → mitigation : plafond `MAX_IMPORT_BATCH_SIZE=500` (borne le pire cas), pas de transaction globale (chaque ligne commit indépendamment, pas de verrou long).
- Risque 2 : le dédoublonnage intra-lot fait une comparaison O(n²) naïve si mal implémenté (n téléphones comparés à tous les précédents) → mitigation : construire une `Map<phone, customerId>` du lot en cours au fil de l'itération, lookup O(1) par ligne.
- Risque 3 : incohérence si deux imports concurrents du même lot créent des doublons croisés non détectés (chacun ne voit pas les lignes de l'autre import) → accepté comme limite connue, pas de verrou distribué pour cette story — un import de masse par un grossiste n'est pas un scénario de concurrence réaliste (un seul opérateur, une seule requête).
