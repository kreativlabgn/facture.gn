# Plan : B3 — Récupérer l'accès à un compte owner perdu

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/auth/`
- Persona affecté : owner ayant perdu son accès + backup admin (owner/admin de la même organisation)
- Données sensibles manipulées : mot de passe (génération temporaire), NIF (vérification d'identité)
- Impact réglementaire : aucun direct, mais mécanisme de reprise de contrôle de compte — cible n°1 des attaques

## Décision produit validée avec l'utilisateur
"Backup admin obligatoire" (ADR-042, DAT §9.1) est un **nudge, jamais un blocage** — cohérent avec B1/B4 (inscription self-service jamais bloquée, TTV<5min). Aucune désignation explicite requise : n'importe quel `OrganizationMember` `owner`/`admin` de l'organisation joue ce rôle. La récupération exige qu'un tel membre existe et approuve activement — sinon, hors scope technique (fallback support humain, processus hors de cette codebase).

## Problème (en 3 lignes max)
Seuls `register()`/`login()` existent — un owner qui perd son téléphone/mot de passe est définitivement bloqué hors de son compte, sans aucun mécanisme de reprise.

## Solution retenue (en 5 lignes max)
`POST /auth/recovery-requests` (public, `msisdn` + `organizationNif`) crée une `AccountRecoveryRequest(status=pending)` si et seulement si la correspondance existe (msisdn → user, nif → org, membership actif), mais renvoie **toujours** le même message générique — même principe anti-énumération que `login()`. Un backup admin authentifié (`owner`/`admin` de l'organisation ciblée) approuve (`POST .../approve`, mot de passe temporaire généré et renvoyé uniquement à lui) ou rejette (`POST .../reject`) la demande — transaction atomique, protégée contre une double résolution concurrente (même pattern `updateMany`+`count` que C5/C15).

## Alternatives écartées
- **Champ `isBackupAdmin` dédié sur `OrganizationMember`** — écarté : `role ∈ {owner, admin}` couvre déjà exactement ce besoin, un nouveau champ dupliquerait une notion déjà exprimée par le RBAC existant.
- **Notification SMS/email automatique au demandeur** — écarté : aucune infrastructure d'envoi construite dans ce codebase (ni SMS ni email). Le mot de passe temporaire est transmis par l'admin approbateur de vive voix (contexte PME).
- **Expiration automatique des demandes pending** — écarté : aucun scheduler n'existe dans ce codebase (même raisonnement que C5 pour le no-show). Une demande reste `pending` jusqu'à résolution active.
- **Généraliser `RolesGuard`** pour cette nouvelle route — écarté : la vérification "approbateur = owner/admin de l'organisation ciblée par la demande" est faite manuellement dans le service (le commentaire de `RolesGuard.resolveOrganizationId()` accepte déjà ce pattern pour des formes de routes non couvertes par sa résolution actuelle).

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — nouveau modèle `AccountRecoveryRequest` (id, userId, organizationId, status, requestedAt, resolvedAt, resolvedByUserId) + enum `RecoveryStatus {pending, approved, rejected}` + migration
- [ ] Tâche 2 : `apps/trust-api/src/auth/dto/request-recovery.dto.ts` (nouveau) — `{ msisdn, organizationNif }`
- [ ] Tâche 3 : `apps/trust-api/src/auth/password.service.ts` — ajouter `generateTemporaryPassword()` (crypto.randomBytes, jamais un algorithme faible)
- [ ] Tâche 4 : `apps/trust-api/src/auth/auth.service.ts` — `requestRecovery(dto)` : résout msisdn→user et nif→org, vérifie une adhésion active, crée la demande SEULEMENT si tout correspond, retourne toujours la même réponse générique (aucune fuite d'information sur la correspondance)
- [ ] Tâche 5 : `apps/trust-api/src/auth/auth.service.ts` — `resolveRecovery(requestId, approverId, decision: "approved" | "rejected")` : vérifie que l'approbateur est `owner`/`admin` de l'organisation de la demande (et ≠ le demandeur), garde `updateMany`+`count` contre la double résolution, si `approved` génère et hash un mot de passe temporaire, retourne le mot de passe en clair UNIQUEMENT dans cette réponse
- [ ] Tâche 6 : `apps/trust-api/src/auth/auth.controller.ts` — routes `POST /auth/recovery-requests` (`@Public()`), `POST /auth/recovery-requests/:id/approve`, `POST /auth/recovery-requests/:id/reject` (JWT requis, pas de `@Roles()` — vérification manuelle dans le service, spécifique à l'organisation de la demande)

## Tests à écrire AVANT le code
- [ ] Test 1 : `auth.service.spec.ts` — `requestRecovery()` crée une demande `pending` quand msisdn+nif correspondent à un membre actif
- [ ] Test 2 : `auth.service.spec.ts` — `requestRecovery()` ne crée AUCUNE demande si le msisdn est inconnu, mais retourne la même réponse que le cas de succès (anti-énumération)
- [ ] Test 3 : `auth.service.spec.ts` — `requestRecovery()` ne crée AUCUNE demande si le nif ne correspond à aucune organisation dont l'utilisateur est membre, même réponse générique
- [ ] Test 4 : `auth.service.spec.ts` — `resolveRecovery()` refuse un approbateur qui n'est ni owner ni admin de l'organisation de la demande
- [ ] Test 5 : `auth.service.spec.ts` — `resolveRecovery()` refuse que le demandeur approuve sa propre demande
- [ ] Test 6 : `auth.service.spec.ts` — `resolveRecovery(..., "approved")` génère un mot de passe temporaire, met à jour `passwordHash`, retourne le mot de passe en clair
- [ ] Test 7 : `auth.service.spec.ts` — `resolveRecovery(..., "rejected")` ne touche jamais `passwordHash`
- [ ] Test 8 : `auth.service.spec.ts` — refuse une double résolution concurrente d'une même demande (course, même pattern que C5/C15)

## Critères de done
- Tous les tests verts (suite complète)
- Build/lint/typecheck verts
- Vérification E2E réelle : demande de récupération avec correspondance correcte → approbation par un backup admin → mot de passe temporaire fonctionnel (login réussi avec) ; demande avec msisdn/nif incorrect → même réponse générique (vérifiée par comparaison de payload) ; rejet ; refus d'auto-approbation ; refus d'un non-membre
- `dev-code-reviewer` OK
- `dev-security-reviewer` obligatoire (mécanisme de reprise de compte, génération de mot de passe, anti-énumération)

## Risques identifiés & mitigations
- **Risque** : fuite d'information sur l'existence d'un compte/organisation via le timing ou le contenu de la réponse de `requestRecovery()`. **Mitigation** : réponse strictement identique (message + code HTTP) que la correspondance existe ou non — testé explicitement (Tests 2, 3). Le timing exact n'est pas rendu strictement constant (aucun autre endpoint de ce codebase ne le fait non plus, y compris `login()`) — cohérent avec le niveau de rigueur déjà établi, à durcir si la revue sécurité le juge insuffisant.
- **Risque** : un membre malveillant du personnel approuve une prise de contrôle non légitime. **Mitigation** : hors scope technique — la vérification humaine (le backup admin connaît personnellement le owner) est la garantie de ce MVP, pas un mécanisme cryptographique supplémentaire.
- **Risque** : double approbation concurrente générant deux mots de passe temporaires distincts, l'un silencieusement invalide. **Mitigation** : garde `updateMany`+`count`, même pattern que C5/C15 (Test 8).
