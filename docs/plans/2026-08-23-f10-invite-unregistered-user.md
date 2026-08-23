# F10 — Inviter un collaborateur (organisation ou cabinet) sans compte facture.gn

## Contexte et preuve du périmètre réel

Une tentative précédente de cette story avait mal interprété le périmètre (construit
une notification de découverte du portail client, redondante avec F13 déjà livrée).
Le vrai périmètre est prouvé directement par deux commentaires écrits lors de la
construction de F8 et F14 :

`apps/trust-api/src/practices/practices.service.ts:40-46` (F8) :
> F10 (hors scope ici) couvre l'invitation d'un utilisateur SANS compte facture.gn —
> ici l'invité est déjà inscrit, identifié par UserPhone (même mécanisme de résolution
> que OrganizationsService.createAssisted()).

`apps/trust-api/src/organizations/organizations.service.ts:348-353` (F14) :
> L'invité doit déjà avoir un compte facture.gn — inviter un utilisateur sans compte
> est un mécanisme distinct (F10/ADR-096), hors scope ici.

Backlog ligne 326 : **F10 — Inviter un client [comprendre : un futur utilisateur
facture.gn] non encore inscrit `[SHOULD]`, Réf ADR-068** (même ADR que F4/F8,
domaine cabinet/CGA — mais le gap touche symétriquement `OrganizationsService`
(F14) ET `PracticesService` (F8), tous deux résolvent l'invité par `UserPhone` et
échouent (`NotFoundException`) si le numéro n'a aucun compte.

## Décisions de conception actées

1. **Mécanisme distinct, pas un fallback dans `inviteMember()` existant.** Les
   commentaires eux-mêmes disent "mécanisme distinct" — je crée un nouveau modèle
   `PendingMemberInvite` + un endpoint séparé (`POST .../pending-invites`) plutôt que
   de faire silencieusement basculer `inviteMember()` sur un chemin différé quand
   `UserPhone` ne résout à rien. Risque de régression bien plus faible (le
   comportement testé de `inviteMember()` — 404 immédiat si compte introuvable —
   reste inchangé), et le produit reste explicite sur "ceci est un envoi différé".
2. **Un seul modèle, deux cibles mutuellement exclusives** (`organizationId`/
   `practiceId`, comme `AssistedSession`/`Mandate` sont chacun scopés à un seul type
   de cible) plutôt que deux modèles dupliqués. `role` stocké en `String` (pas un
   enum Prisma) car `OrganizationRole` et `PracticeMemberRole` sont deux enums
   disjoints — validé côté service contre le bon enum selon la cible, même
   compromis déjà accepté dans ce repo pour `UssdSession.state` (typage TypeScript
   uniquement, pas de contrainte DB).
3. **`expiresAt` RÉELLEMENT filtré partout, dès la première version** — leçon
   apprise deux fois cette session (`AssistedSession` puis `Mandate` ont eu ce
   champ scaffoldé sans jamais être appliqué). TTL 14 jours arbitraire (aucune
   spec ne fixe de durée — plus court que les 90 jours d'`AssistedSession` car une
   invitation de collaborateur non répondue perd rapidement sa pertinence,
   contrairement à un mandat commercial terrain), ajustable en un point unique.
4. **Résolution automatique à l'inscription** : quand un `User`+`UserPhone` se
   crée pour un numéro avec une ou plusieurs `PendingMemberInvite` en attente
   (non expirée, non révoquée, non acceptée), CHAQUE invitation résout
   immédiatement en `OrganizationMember`/`PracticeMember` dans la même
   transaction — jamais un flux d'acceptation manuelle (cohérent avec
   `inviteMember()` existant : "ajout immédiat, aucun flux d'acceptation,
   contrairement au mandat"). Branché à 2 des 3 points de création `User`+`UserPhone`
   identifiés : `AuthService.register()` (PWA), `OrganizationsService.createAssisted()`
   (agent terrain). **Décision délibérée d'EXCLURE `ClientPortalAuthService`**
   (F13, auto-inscription OTP) : ce chemin crée un `User` sans `passwordHash`/
   `pinHash` (jamais utilisable pour `/auth/login` ni `*620#`) — résoudre une
   invitation là créerait un membership fantôme inutilisable, ET bloquerait
   toute inscription PWA réelle ultérieure sur ce numéro (`register()` rejette
   déjà un `msisdn` existant). Une invitation reçue par quelqu'un qui commence
   par le portail client doit d'abord s'inscrire normalement sur la PWA pour
   être résolue. Module `@Global()` (même pattern que `NotificationsModule`/
   `AuthModule`) pour éviter tout import circulaire entre les modules
   consommateurs.
5. **Mêmes gardes de sécurité que `inviteMember()` classique** : owner/admin pour
   une organisation (jamais `owner` invitable — restriction déjà en place,
   Security Audit finding #12, répliquée ici), `practice_admin` pour un cabinet
   (`assertPracticeAdmin`, helper déjà extrait lors du Quality Audit). L'existence
   d'une `PendingMemberInvite` seule ne donne JAMAIS un accès — aucune lecture RBAC
   ne la consulte, seule la résolution à l'inscription la consomme.
6. **Doublon d'invitation** : une invitation déjà en attente (non résolue, non
   expirée, non révoquée) pour le même `(msisdn, organizationId)` ou
   `(msisdn, practiceId)` est rejetée (`ConflictException`), pas silencieusement
   remplacée — cohérent avec le refus de réactivation silencieuse déjà documenté
   sur `OrganizationMember`.
7. **Révocation** : `updateMany`+`where` (garde de concurrence, pattern établi
   cette session), symétrique à `revokeAssistedSession()`.
8. **Notification** : réutilise `resolveNotificationProviders`/`SMS_PROVIDER`
   (précédent `PaymentReminderService`, I2) — SMS uniquement par défaut (pas de
   préférence de canal connue pour un numéro sans compte). Best-effort, jamais
   couplé à la réussite de la création de l'invitation.
9. **Tier/quota** : la création d'une `PendingMemberInvite` pour une organisation
   revérifie `isRoleAllowedForTier`/`maxMembersForTier` (même gardes que
   `inviteMember()`) — mais la résolution à l'inscription ne re-vérifie PAS ces
   limites (accepté comme limite connue : un downgrade de palier entre
   l'invitation et l'inscription est un cas rare, documenté, même classe de
   compromis que le TOCTOU déjà accepté sur `branches.service.ts`).

## Tâches

1. Schéma : modèle `PendingMemberInvite` + relations (`Organization`,
   `ProfessionalPractice`, `User` ×2 relations nommées) + migration.
2. `PendingMemberInviteService` : `inviteToOrganization()`, `inviteToPractice()`,
   `resolveForNewUser(tx, userId, msisdn)`, `revoke()`, `listPending()`.
3. Endpoints : `POST /organizations/:id/pending-invites` (+`@Roles("owner","admin")`),
   `POST /organizations/:id/pending-invites/:inviteId/revoke`,
   `POST /practices/:id/pending-invites` (autorisation inline `assertPracticeAdmin`),
   `POST /practices/:id/pending-invites/:inviteId/revoke`.
4. Câblage de la résolution dans les 3 points de création `User`+`UserPhone`.
5. Notification SMS best-effort à la création.

## Tests prévus

- Création : owner/admin peut inviter (organisation), practice_admin peut inviter
  (cabinet) ; rejet si rôle non autorisé (non-admin, `owner` demandé) ; rejet si
  numéro déjà membre ; rejet si invitation déjà en attente pour ce couple
  (numéro, cible) ; rejet si tier/quota dépassé (organisation).
- Résolution : un `User` qui s'inscrit (via `register()`) avec une invitation en
  attente devient membre automatiquement ; deux invitations (une org + une
  practice) résolvent toutes les deux ; une invitation expirée NE résout PAS ;
  une invitation révoquée NE résout PAS ; un numéro sans aucune invitation ne
  déclenche rien (chemin normal inchangé).
- Révocation : garde de concurrence (`updateMany`+`where`), 404 si déjà résolue/
  déjà révoquée/introuvable.
- Notification : envoyée best-effort, échec du provider n'empêche jamais la
  création de l'invitation.

## Critères de "done"

- Un owner peut inviter un collaborateur par téléphone même sans compte existant ;
  ce collaborateur devient membre automatiquement dès qu'il s'inscrit sur la PWA.
- Même mécanisme pour un cabinet/CGA (`practice_admin`).
- `expiresAt` réellement appliqué (invitation expirée = jamais résolue).
- Suite complète trust-api verte, typecheck/lint clean.
