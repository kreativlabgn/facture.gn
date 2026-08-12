# Plan : Export FEC d'une organisation cliente depuis le cabinet

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : frontend uniquement (`apps/web`) — `GET /organizations/:id/fec` (trust-api) est déjà mandate-aware (`FecService` délègue à `OrganizationAccessService` depuis la tâche `organization-mandate-access-guard`, déjà mergée). Story F9.
- Persona affecté : personnel de cabinet comptable/CGA.
- Données sensibles : fichier FEC (écritures comptables, montants) d'une organisation tierce — mêmes données déjà accessibles via `GET /organizations/:id/invoices` (tâche précédente), pas une nouvelle catégorie.
- Impact réglementaire : direct — FEC = obligation OHADA/SYSCOHADA.

## Investigation préalable

Rien à construire côté trust-api — le seul gap est frontend : `dashboard/settings/fec/route.ts` existant résout l'organisation via `listMyOrganizations()[0]` (contexte PME, un seul owner), inutilisable tel quel en contexte cabinet (l'organisation ciblée est un PARAMÈTRE d'URL, pas déduite du compte connecté).

## Décision d'architecture

Nouveau Route Handler `apps/web/src/app/cabinet/organizations/[organizationId]/fec/route.ts` — même logique de proxy streaming que l'existant, mais `organizationId` vient directement de `params` (dynamic segment), aucun appel `GET /organizations` intermédiaire nécessaire (économise une requête par rapport à la version PME). Bouton "Télécharger le FEC" ajouté sur `cabinet/organizations/[organizationId]/page.tsx` (déjà mergée), pointant vers cette route.

## Alternatives écartées

**Factoriser les deux route handlers (PME et cabinet) en une fonction partagée** — écartée, la version PME résout l'organisation différemment (compte connecté vs paramètre d'URL) ; les deux corps de fonction sont courts et la duplication actuelle (10 lignes de proxy streaming) ne justifie pas une abstraction (règle des trois pas encore atteinte, un seul autre appelant).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/web/src/app/cabinet/organizations/[organizationId]/fec/route.ts`
- [ ] Tâche 2 : bouton "Télécharger le FEC" sur `cabinet/organizations/[organizationId]/page.tsx`

## Critères de done
- typecheck + lint + build verts
- Vérification manuelle : téléchargement déclenché depuis l'écran cabinet, erreur 403 propre si l'organisation ciblée ne correspond à aucun mandat actif de l'appelant

## Risques identifiés & mitigations
- Risque 1 : aucun — route déjà protégée côté trust-api, ce plan ne fait que l'exposer depuis un second contexte frontend légitime.
