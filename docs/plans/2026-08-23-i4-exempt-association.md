# Plan — I4 : Configurer une organisation comme association exonérée

Story : Backlog `V/Backlog-facture-gn.md:443` — **I4 — Configurer une organisation
comme association exonérée `[COULD]`** — Réf ADR-057.

## Décision de scope — "hors MVP" mais construite sur demande explicite

`V/Backlog-facture-gn.md:230-231` :
> **ADR-057 — Formes juridiques : legal_form distinct de regime_fiscal, 4e valeur
> associative** — Décision : organization.legal_form (commercial/association).
> non_assujetti_association. **Hors MVP.**

`apps/trust-api/src/invoices/tax-regime.ts:6-9` :
> `non_assujetti_association` est exonérée par nature ; le **mécanisme
> d'exemption détaillé (I4) est hors MVP**, mais 0% reste le défaut le plus sûr
> pour une entité qui ne doit structurellement jamais facturer de TVA.

ADR-057 et le code marquent explicitement I4 "hors MVP". L'utilisateur a
demandé explicitement de la construire quand même. Cette décision de scope est
documentée ici comme un choix assumé, pas un oubli de la spec : on construit un
sous-ensemble minimal de I4 (voir "Ce qui N'EST PAS construit" ci-dessous), pas
le "mécanisme d'exemption détaillé" complet (vérification documentaire,
justificatif d'association, etc.) que ADR-057/tax-regime.ts renvoient hors MVP.

## État actuel constaté (vérifié dans le code, pas supposé)

- `Organization.legalForm` (enum `LegalForm` : `commercial`/`association`) et
  `Organization.regimeFiscal` (enum `RegimeFiscal` : `normal_tva`/`tpu`/
  `normal_sans_tva`/`non_assujetti_association`) existent déjà
  (`packages/db/prisma/schema.prisma:38-48, 487-488`).
- Les deux champs sont posés **librement et indépendamment**, sans aucune
  validation croisée, dans les 3 chemins de création d'organisation :
  - `apps/trust-api/src/organizations/dto/create-organization.dto.ts` (Chemin A,
    self-service) — `z.object({...}).refine(nif<->etaxNumber conjoints)`.
  - `apps/trust-api/src/organizations/dto/create-assisted-organization.dto.ts`
    (Chemin B, agent terrain) — même structure, même refine NIF/eTax dupliqué
    (commentaire du fichier : "non extensible via `.extend()`" sur un ZodEffects
    post-refine — confirmé : on peut en revanche **chaîner** un second
    `.refine()` sur un ZodEffects, ce n'est que `.extend()` qui échoue).
  - `apps/trust-api/src/organizations/dto/create-from-apip.dto.ts` (webhook APIP)
    — `z.object({...})` sans refine existant.
- `organizations.service.ts` (`create()` L70-97, `createAssisted()` L140-211,
  `createFromApip()` L251-277) pose `regimeFiscal`/`legalForm` tels quels depuis
  le DTO déjà validé, sans revalidation métier.
- `tax-regime.ts` : `non_assujetti_association` → 0 bps de TVA (exonération
  totale), déjà utilisé en prod par `invoices.service.ts` (`createDraft()` et
  `convertToInvoice()`).
- **Aucun endpoint de changement de régime fiscal ou de forme juridique
  n'existe après création.** Confirmé par grep sur le controller
  (`organizations.controller.ts`, aucune route `PATCH`/`POST .../regime` ou
  `.../legal-form`) et par le commentaire explicite de
  `invoices.service.ts:413-417` : *"même si regimeFiscal n'est modifiable nulle
  part aujourd'hui, cette règle protège contre une dérive silencieuse le jour
  où un mécanisme de changement existera"*. → **La story se limite donc à
  sécuriser les 3 chemins de création existants.** Aucun endpoint de
  changement de régime à créer ou modifier.
- Aucune clarification dans `V/` (Backlog, Registre ADR, DAT, ERD, Risques-RACI)
  sur la question "une association DOIT-elle nécessairement être
  `non_assujetti_association`, ou peut-elle légitimement choisir un autre
  régime (activité commerciale accessoire imposable) ?" — recherché par grep
  case-insensitive sur "ADR-057", "I4", "exonér", "association" dans tout `V/`.

## Le vrai trou (vulnérabilité)

Aujourd'hui, n'importe quelle organisation avec `legalForm: "commercial"` peut
librement se déclarer `regimeFiscal: "non_assujetti_association"` à la
création et échapper structurellement à la TVA sans aucune légitimité — un
vecteur de fraude fiscale directement exploitable via l'API existante (3
chemins de création, aucune validation croisée).

## Décisions de conception

### 1. Où placer la règle de validation

**Choix : validation Zod cross-field via `.refine()` sur chacun des 3 DTOs de
création**, pas de vérification dans le service.

Justification :
- Cohérent avec le pattern déjà en place : `createOrganizationSchema` et
  `createAssistedOrganizationSchema` ont déjà un `.refine()` cross-field (NIF/
  eTax conjoints). Ajouter un second `.refine()` est la continuité naturelle du
  style existant, pas une nouvelle couche.
- Un ZodEffects (résultat de `.refine()`) supporte le chaînage d'un nouveau
  `.refine()` (contrairement à `.extend()`, qui échoue sur un ZodEffects — déjà
  noté dans le commentaire de `create-assisted-organization.dto.ts:5-6`) : donc
  aucun obstacle technique à ajouter une seconde règle par ce mécanisme.
  `createFromApipSchema` n'a pas encore de refine : premier `.refine()` ajouté
  directement dessus.
- Erreur détectée au niveau `ZodValidationPipe` (400 Bad Request), avant toute
  transaction Prisma — cohérent avec le principe déjà appliqué au refine NIF/
  eTax ("jamais un défaut TVA silencieux", commentaire ligne 6 de
  `create-organization.dto.ts`).
- Alternative écartée : vérification dans `organizations.service.ts`. Rejetée
  car redondante avec le pattern DTO déjà établi pour exactement ce type de
  règle (cross-field sur les mêmes deux champs déjà validés ensemble pour NIF/
  eTax), et parce que le service n'a aujourd'hui aucune logique de rejet sur
  ces deux champs — les DTOs sont la seule source de vérité de validation
  d'entrée pour `regimeFiscal`/`legalForm`.

### 2. Sens de la contrainte : commercial → exonéré interdit ; association → régime libre

**Choix : n'interdire que le sens dangereux.** `regimeFiscal:
"non_assujetti_association"` est rejeté si `legalForm !== "association"`.
L'inverse n'est PAS contraint : une organisation `legalForm: "association"`
peut choisir n'importe quel `regimeFiscal` (y compris `normal_tva`, `tpu`,
`normal_sans_tva`).

Justification :
- Aucune clarification trouvée dans `V/` sur l'obligation inverse.
- En droit réel des associations, une activité commerciale accessoire
  imposable est plausible (une association peut avoir des revenus commerciaux
  soumis à TVA au-delà de son objet non lucratif) — imposer
  `non_assujetti_association` à toute association fermerait une possibilité
  légitime sans fondement dans la spec disponible.
- La vulnérabilité identifiée ne porte que sur le sens
  commercial→exonération-illégitime. Contraindre l'autre sens ajouterait une
  restriction non demandée et non justifiée par une source — violerait le
  principe "reste minimal".
- Décision assumée faute de spec plus précise, documentée ici explicitement
  pour permettre une révision future si une clarification produit apparaît.

### 3. Endpoint de changement de régime après création

Vérifié : **aucun endpoint de ce type n'existe** (voir "État actuel constaté"
ci-dessus). Donc aucune sécurisation supplémentaire à apporter côté
changement — seuls les 3 chemins de création sont concernés.

### 4. Ce qui N'EST PAS construit (hors scope assumé)

- Aucun workflow de vérification documentaire/justificatif d'association
  (statuts, récépissé, etc.) — ADR-057/tax-regime.ts renvoient explicitement
  ce "mécanisme d'exemption détaillé" hors MVP ; rien dans la demande
  n'annule cette exclusion, seule la fermeture de la faille structurelle est
  demandée.
- Aucun nouvel endpoint, aucune migration de données existantes, aucun champ
  supplémentaire sur `Organization`. Le schéma Prisma n'est pas modifié.

## Tâches (TDD strict)

1. `create-organization.dto.spec.ts` — RED : test "rejette
   regimeFiscal=non_assujetti_association avec legalForm=commercial" +
   test "accepte regimeFiscal=non_assujetti_association avec
   legalForm=association" + test "accepte une association avec un régime non
   exonéré (activité commerciale accessoire)". GREEN : ajout du `.refine()`
   sur `createOrganizationSchema`.
2. Même trio de tests + implémentation sur
   `create-assisted-organization.dto.spec.ts` (à créer, n'existe pas encore) /
   `create-assisted-organization.dto.ts`.
3. Même trio de tests + implémentation sur un nouveau
   `create-from-apip.dto.spec.ts` (à créer) / `create-from-apip.dto.ts`.
4. Vérifier `organizations.service.spec.ts` : aucun changement de
   comportement attendu au niveau service (la garde est au DTO, en amont) —
   relancer la suite existante pour confirmer l'absence de régression.
5. `pnpm --filter trust-api test`, `typecheck`, `lint`.

## Critères de "done"

- Les 3 DTOs de création rejettent `legalForm: "commercial"` +
  `regimeFiscal: "non_assujetti_association"` avec un message d'erreur clair
  citant I4/ADR-057.
- Les 3 DTOs acceptent toujours `legalForm: "association"` +
  `regimeFiscal: "non_assujetti_association"`.
- Les 3 DTOs acceptent toujours `legalForm: "association"` + un régime non
  exonéré (`normal_tva`/`tpu`/`normal_sans_tva`).
- Aucune régression sur les tests existants (NIF/eTax conjoints, etc.).
- `test`, `typecheck`, `lint` verts sur `apps/trust-api`.
- Aucune modification de `schema.prisma` (aucune régénération Prisma requise).
- Aucun endpoint créé ou modifié (confirmé : aucun n'existe pour le
  changement de régime).
