# F13 — Portail client (consulter mes factures reçues, tous émetteurs) — ADR-096, ADR-108

## Contexte

Seul MUST restant du backlog (77 stories). `client_portal` est une identité auto-résolue par
téléphone vérifié (ADR-096) — jamais un `OrganizationMember` invité/révocable. Deux canaux
(ADR-108) : OTP SMS pour la PWA (à chaque connexion), PIN direct inchangé sur *620#
(réutilise `UssdAuthService`, déjà en prod). Aucun nouveau champ sur `Customer`/`Invoice` —
résolution `Customer.phone = UserPhone.msisdn` à la volée, à travers toutes les organisations.

## Décisions de conception actées

1. **OTP** : nouveau modèle `ClientPortalOtp` (msisdn, codeHash argon2id, expiresAt, consumedAt,
   attempts). Code à 4 chiffres (ADR-108), TTL 5 min, 3 tentatives max avant qu'un nouveau code
   soit nécessaire (même ordre de grandeur que `PIN_MAX_ATTEMPTS`). Consommation atomique
   (`updateMany`+`where: consumedAt: null`, pattern établi cette session) — anti-rejeu.
2. **Résolution/création d'identité** : à la vérification OTP réussie, `UserPhone.msisdn` est
   cherché ; s'il n'existe pas, un `User` (sans `passwordHash`/`pinHash`) + `UserPhone`
   (`verifiedAt: now`) sont créés à la volée — c'est le mécanisme d'auto-inscription du client
   (ADR-096 : « aucune invitation préalable requise »). S'il existe déjà (ex. la personne est
   aussi collaborateur d'une organisation), le `User` existant est réutilisé tel quel — jamais
   deux identités pour un même numéro.
3. **Token de session** : réutilise tel quel `AUTH_TOKEN_SERVICE`/`JwtAuthGuard` déjà globaux
   (RS256, révocation par `jti`) — aucun nouveau mécanisme de token. Le contrôleur portail
   n'utilise NI `@Roles()` NI `@OrganizationIdSource` (comme `PublicBuyerPortalController`,
   seul précédent d'identité "transverse" du repo) : toute l'autorisation est inline, basée sur
   la correspondance `Customer.phone` ∈ numéros vérifiés de `CurrentUser().id`.
4. **USSD** : nouvelle option **"6. Factures reçues"** au menu racine (les 5 slots existants sont
   déjà pris). Réutilise l'identité déjà résolue par PIN (`UssdAuthService`, inchangé par
   ADR-108) — aucun OTP côté USSD. Réponse en un seul écran (résumé par organisation : nom +
   solde dû), pas de pagination — le canal USSD ne permet pas un drill-down facture par facture
   dans la fenêtre de 90s ; ce niveau de détail reste réservé à la PWA.
5. **Listing PWA** : `GET /client-portal/organizations` (découverte, résumé par organisation :
   `organizationId`, `name`, `runningBalance`, `creditLimit`) puis
   `GET /client-portal/customers/:customerId/invoices` (paginé, convention `take`/`skip`
   déjà établie) — le service revérifie à CHAQUE appel que `customer.phone` correspond bien à
   un numéro vérifié de l'appelant (jamais une confiance dans un `customerId` fourni en query
   sans revalidation, IDOR).
6. **Anti-énumération** : `requestOtp` répond toujours de façon identique, que le numéro
   corresponde ou non à un `Customer` existant quelque part (le lien ne se fait qu'à la lecture,
   jamais à la demande d'OTP) — même principe que `requestRecovery()`.

## Tâches

1. Schéma : `ClientPortalOtp` + migration, `db:generate`/`build`.
2. `ClientPortalAuthService` (requestOtp/verifyOtp) + DTOs Zod + tests.
3. `ClientPortalAuthController` (`POST /client-portal/otp/request`, `POST /client-portal/otp/verify`,
   `@Public()` + `@Throttle` strict comme `auth.controller.ts`).
4. `ClientPortalService` (listOrganizations/listInvoices, autorisation inline) + tests.
5. `ClientPortalController` (`GET /client-portal/organizations`,
   `GET /client-portal/customers/:customerId/invoices`) — JWT global uniquement.
6. `ClientPortalModule`, enregistrement dans `app.module.ts`.
7. USSD : option "6", `AUTHENTICATED_OPTIONS`, handler résumé par organisation, tests.

## Critères de "done"

- Un numéro jamais vu peut demander un OTP, le vérifier, et obtenir un token sans invitation
  préalable d'aucune organisation.
- Le portail ne renvoie QUE les organisations/factures où `Customer.phone` correspond à un
  numéro vérifié de l'appelant — jamais les données d'un autre client (test IDOR dédié).
- `*620#` option 6 fonctionne pour un numéro déjà PIN-authentifié, résumé multi-organisation.
- Suite trust-api complète verte, typecheck/lint clean.
