# Plan : Gestion des collaborateurs et mandats depuis le cabinet

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/practices/`, `apps/trust-api/src/mandates/` (deux nouveaux endpoints de LECTURE, aucune nouvelle mutation — F1/F5/F6/F8/F12 existent déjà) + frontend cabinet.
- Persona affecté : `practice_admin` (gère collaborateurs et mandats) et tout `PracticeMember` actif (consultation).
- Données sensibles : liste des collaborateurs (nom, rôle) et des mandats (quelle organisation, quel statut) d'un cabinet — pas de nouvelle catégorie, déjà stocké.
- Impact réglementaire : aucun direct.

## Investigation préalable

Toutes les mutations existent déjà et sont testées : `POST /practices/:id/members` (F8, inviter), `POST /practices/:id/mandates` (F5, demander un mandat), `POST /practices/:id/mandates/:mandateId/revoke` (F6), `POST /practices/:id/mandates/:mandateId/accept-request` (F12, accepter une adhésion initiée par une organisation), `POST /organizations/:id/mandates/:mandateId/accept` (F1, côté organisation — hors scope cabinet).

**Gap découvert en lisant `practices.service.ts`/`mandates.service.ts` intégralement** : **aucun endpoint ne LISTE** les collaborateurs d'une practice, ni les mandats d'une practice au-delà des actifs (`listAccessibleOrganizations` filtre `status: "active"` uniquement). Concrètement :
- Impossible pour l'UI d'afficher la liste des collaborateurs à côté du bouton "inviter".
- Impossible pour l'UI de découvrir le `mandateId` d'un mandat `pending` initié par une organisation (nécessaire pour appeler `accept-request`) — le mandat existe en base mais rien ne le rend visible au cabinet avant acceptation.
- Impossible d'afficher "demande envoyée, en attente" pour un mandat `pending` initié par la practice elle-même (F5).

Ce plan ajoute donc deux endpoints de lecture, aucune nouvelle règle métier (les gardes d'autorisation existantes — `practice_admin` pour les mutations, tout membre actif pour la lecture — sont simplement répliquées, même précédent que `listAccessibleOrganizations` F7).

## Décision d'architecture

**Backend** :
- `GET /practices/:id/members` (`PracticesController`) — tout membre actif peut consulter (même garde que F7). `PracticesService.listMembers(practiceId, requesterUserId)` → `practiceMember.findMany({ where: { practiceId, leftAt: null }, include: { user: { select: { id, name } } } })`.
- `GET /practices/:id/mandates` (`MandatesController`) — tout membre actif peut consulter. `MandatesService.listAll(practiceId, requesterUserId)` → `mandate.findMany({ where: { practiceId, status: { in: ["pending", "active"] } }, include: { organization: { select: { id, name } } } })` — `revoked`/`expired` exclus (bruit historique non nécessaire à l'action, cohérent avec le principe déjà appliqué : afficher ce qui est actionnable).

**Frontend** — deux nouveaux écrans :
- `cabinet/members/page.tsx` — liste des collaborateurs + formulaire d'invitation (msisdn, rôle fixé à `accountant_external`, seul choix MVP).
- `cabinet/mandates/page.tsx` — liste des mandats (organisation, statut, rôle accordé, sens d'initiation) avec actions contextuelles : mandat `pending`+`initiatedBy: organization` → bouton "Accepter" (`accept-request`) ; mandat `active` → bouton "Révoquer" ; mandat `pending`+`initiatedBy: practice` → aucune action, juste "En attente". Formulaire "Demander un mandat" (organizationId, rôle fixé) pour F5.

Ces deux écrans nécessitent les boutons d'action existants (`revoke`, `accept-request`, `create` mandat, `inviteMember`) déjà exposés côté trust-api — uniquement du câblage frontend une fois les deux endpoints de lecture ajoutés.

## Alternatives écartées

**Étendre `listAccessibleOrganizations` pour inclure tous les statuts** — écartée : cette méthode sert F7 (switch d'organisation), qui n'a structurellement de sens que pour un mandat `active` (pas question de "switcher" vers une organisation en attente). Un endpoint séparé `listAll` pour l'écran "Mandats" garde chaque méthode alignée sur un seul cas d'usage.

**Ajouter `POST /organizations/:id/mandates/:mandateId/accept` (F1) à ce périmètre** — écartée, c'est une action côté ORGANISATION (un owner/admin PME acceptant une demande de cabinet), pas une action cabinet — hors scope de cette feuille de route (dashboard cabinet), appartient au dashboard PME si jamais construit.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `practices.service.spec.ts` — `listMembers()` : retourne les membres actifs avec nom ; refuse un non-membre
- [ ] Tâche 2 (GREEN) : `PracticesService.listMembers()`, `PracticesController.GET(":id/members")`
- [ ] Tâche 3 (RED) : `mandates.service.spec.ts` — `listAll()` : retourne pending+active avec organisation ; exclut revoked/expired ; refuse un non-membre
- [ ] Tâche 4 (GREEN) : `MandatesService.listAll()`, nouvelle route dans `MandatesController` (`GET /practices/:id/mandates`)
- [ ] Tâche 5 : `src/lib/trust-api.ts` — `listPracticeMembers`, `inviteMember`, `listPracticeMandates`, `requestMandate`, `revokeMandate`, `acceptMandateRequest`
- [ ] Tâche 6 : `cabinet/members/page.tsx` + formulaire d'invitation
- [ ] Tâche 7 : `cabinet/mandates/page.tsx` + formulaire de demande + boutons d'action

## Critères de done
- Suite trust-api et web vertes, typecheck/lint/build verts des deux côtés
- Un `accountant_external` (non `practice_admin`) peut consulter les deux écrans mais ne voit aucun bouton d'action réservé à `practice_admin` (invite, revoke, demande) — vérifié par un test explicite, pas seulement par omission visuelle (le backend doit aussi refuser l'action si l'UI était contournée)

## Risques identifiés & mitigations
- Risque 1 : UI affichant un bouton d'action à un rôle non habilité, qui échouerait silencieusement ou avec une erreur brute → mitigation : les boutons `inviter`/`révoquer`/`demander` ne sont rendus QUE si `practice.role === "practice_admin"` (donnée déjà disponible via `listMyPractices()`), en plus de la garde serveur déjà existante (défense en profondeur, pas une confiance aveugle au frontend).
