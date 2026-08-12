# Plan : Option 5 USSD — Gérer mon compte

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/` + extensions `mandates/`).
- Persona affecté : marchand authentifié gérant son PIN, son palier, et l'accès de ses cabinets/CGA mandatés.

## Investigation préalable

§2.5 Spec USSD : « 5.1 Changer mon PIN · 5.2 Voir mon palier · 5.3 Mandats en attente · 5.4 Mandats actifs. » 5.3 : « acceptation via PIN → mandat accordé ». 5.4 : « révocation possible avec PIN requis. »

**Gap backend découvert en lisant `mandates.service.ts` intégralement** : toutes les méthodes existantes sont **practice-scopées** (`revoke(practiceId, ...)`, `listAll(practiceId, ...)`) — pensées pour un cabinet gérant SES mandats. Rien ne permet à une ORGANISATION de lister ses mandats en attente/actifs, ni de révoquer l'accès d'un cabinet de son propre côté. `accept()` existe déjà côté organisation (F1), mais pas son symétrique lecture/révocation. Cette tâche ajoute donc trois méthodes à `MandatesService`, pas seulement de l'habillage USSD.

§3.3 (déjà lu, tâche `ussd-pin-auth`) : « Reset PIN déclenche une bascule 24-48h vers T0 + SMS systématique. » — **c'est ici, 5.1, que ce mécanisme se câble réellement** (`Organization.paymentsFrozenUntil`, déjà exploité par `VelocityTierService` depuis la tâche `ussd-velocity-tier`, qui force T0 si ce champ est dans le futur). 24h retenu (borne basse de la fourchette 24-48h, cohérent avec le choix déjà fait pour G2/récupération de compte).

`VelocityTierService.assertWithinLimits()` résout un palier en interne mais ne l'expose pas — refactor mineur : extraction d'une méthode publique `resolveTier(organizationId)`, réutilisée par `assertWithinLimits()` ET par 5.2.

## Décision d'architecture

**`MandatesService`** (+3 méthodes) :
- `listPendingForOrganization(organizationId)` → mandats `status: "pending"`, `initiatedBy: "practice"` (F5 — seuls ceux-ci sont acceptables PAR l'organisation ; les `initiatedBy: "organization"`, F12, sont acceptés par la practice via `acceptAsPractice()`, hors scope ici).
- `listActiveForOrganization(organizationId)` → mandats `status: "active"` pour cette organisation.
- `revokeAsOrganization(organizationId, mandateId, actorUserId)` → symétrique de `revoke()` (practice-scopé) mais autorisé owner/admin de l'organisation elle-même (même trio que partout ailleurs), vérifie `mandate.organizationId === organizationId` et `status === "active"`.

**`VelocityTierService.resolveTier(organizationId)`** — extrait de `assertWithinLimits()`, méthode publique.

**`UssdAccountService`** (`ussd/ussd-account.service.ts`) :
- `changePin(userId, organizationId, newPin)` → `UssdAuthService.createPin()` (réutilisé tel quel — même mécanisme que la création initiale) + pose `Organization.paymentsFrozenUntil = now + 24h` + envoi SMS "systématique" via `SMS_PROVIDER` (jamais `PaymentLinkNotificationService`, conçu spécifiquement pour les liens de paiement — un nouveau message générique justifie l'injection directe du provider, pas un détournement d'un service à la responsabilité différente).
- `getTierSummary(organizationId)` → `VelocityTierService.resolveTier()` + libellé.
- `listPendingMandates`/`listActiveMandates`/`acceptMandate`/`revokeMandate` → délèguent aux nouvelles méthodes `MandatesService`.

**Sous-menu `UssdSessionService`** : `manage_account_menu` (déclenché par `completeAuthentication` si `pendingOption === "5"`) affiche 5.1-5.4, chaque choix ouvre son propre sous-flux (nouveau PIN+confirmation pour 5.1 — réutilise le même schéma que le bootstrap, `pay`-style liste+sélection+confirmation pour 5.3/5.4).

## Alternatives écartées

**Autoriser tout membre (pas seulement owner/admin) à révoquer un mandat côté organisation** — écartée, même trio que le reste des actions administratives de ce repo (ex. `merge()` client E4 : "admin/owner uniquement, jamais cashier").

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED/GREEN) : `mandates.service.spec.ts` — 3 nouvelles méthodes
- [ ] Tâche 2 (RED/GREEN) : `velocity-tier.service.spec.ts` — `resolveTier()` extrait, `assertWithinLimits()` inchangé en comportement
- [ ] Tâche 3 (RED/GREEN) : `ussd-account.service.spec.ts` — les 5 méthodes
- [ ] Tâche 4 (RED/GREEN) : câblage `UssdSessionService` — sous-menu + 4 sous-flux

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Un changement de PIN déclenche bien `paymentsFrozenUntil` dans le futur ET un SMS
- Une révocation côté organisation ne fonctionne que sur un mandat réellement `active` de CETTE organisation (jamais un mandat d'une autre org)

## Risques identifiés & mitigations
- Risque 1 : confusion entre `MandatesService.revoke()` (practice) et `revokeAsOrganization()` (organisation) → mitigation : noms distincts sans ambiguïté, tests explicites vérifiant que chacun ne touche que son propre côté.
