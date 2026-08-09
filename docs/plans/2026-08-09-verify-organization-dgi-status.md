# Plan : B2 — Faire passer une organisation en statut vérifié

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/organizations/`
- Persona affecté : aucun rôle organisationnel (le backlog dit "en tant que système") — un appelant interne/backoffice, représenté pour le MVP par un secret partagé dédié
- Données sensibles manipulées : NIF, eTax (déjà collectés, pas de nouvelle collecte)
- Impact réglementaire : aucun nouveau (la conformité DGI elle-même reste hors périmètre — pas d'intégration DGI réelle dans ce MVP)

## Problème (en 3 lignes max)
`Organization.dgiVerificationStatus` démarre à `unverified` (B1/B4) mais rien ne peut le faire progresser — c'est un champ mort. Sans mécanisme de transition explicite et garanti cohérent avec ADR-035 (NIF/eTax conjoints), le statut de vérification DGI ne peut jamais refléter la réalité.

## Solution retenue (en 5 lignes max)
Nouvel endpoint `POST /organizations/:id/verify-dgi`, protégé par un secret dédié (`DGI_VERIFICATION_INTERNAL_KEY`, nouveau guard `DgiVerificationAuthGuard` — mirroir de `InternalAuthGuard` mais secret propre, jamais `MONEY_API_INTERNAL_KEY`). `OrganizationsService.verifyDgi(id)` refuse si `nif`/`etaxNumber` sont absents (`ConflictException` explicite — jamais de vérification DGI sur une organisation qui n'a jamais rien fourni), sinon passe `dgiVerificationStatus` à `verified`. Idempotent : re-vérifier une organisation déjà `verified` est un no-op réussi, pas une erreur.

## Alternatives écartées
- **Ajouter `velocity_tier` au schema maintenant** (tel que littéralement décrit dans le backlog "débloquer T0→T1") — écarté : aucune story consommatrice (D4) n'est construite, aucun code ne lit de palier de vélocité aujourd'hui. L'ajouter maintenant produirait un champ sans consommateur, donc du code mort. Sera ajouté quand D4 sera planifiée.
- **Réutiliser `InternalAuthGuard`/`MONEY_API_INTERNAL_KEY` existant** — écarté : ce secret appartient au périmètre de confiance money-api↔trust-api (confirmation de paiement). Le réutiliser pour déclencher une vérification DGI mélangerait deux périmètres de confiance indépendants — violation de séparation des privilèges.
- **Faire de la vérification une action déclenchable par le rôle `owner`/`admin` de l'organisation elle-même** — écarté : une organisation qui s'auto-certifie "vérifiée DGI" viderait la vérification de tout son sens (elle deviendrait une simple case à cocher, pas une preuve de contrôle indépendant).
- **Implémenter le statut intermédiaire `pending`** — écarté pour ce plan : aucun producteur réel (pas d'intégration DGI asynchrone construite) ; fabriquer une transition vers `pending` sans consommateur serait spéculatif.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `apps/trust-api/src/common/dgi-verification-auth.guard.ts` — nouveau guard, mirroir exact d'`internal-auth.guard.ts` (comparaison à temps constant, fail-fast au boot), lisant `DGI_VERIFICATION_INTERNAL_KEY`
- [ ] Tâche 2 : `apps/trust-api/src/organizations/organizations.service.ts` — nouvelle méthode `verifyDgi(organizationId: string)` : charge l'organisation (`findUniqueOrThrow`), lève `ConflictException` si `nif`/`etaxNumber` absents, no-op si déjà `verified`, sinon `update` vers `verified`
- [ ] Tâche 3 : `apps/trust-api/src/organizations/organizations.controller.ts` — nouvelle route `POST /organizations/:id/verify-dgi`, `@UseGuards(DgiVerificationAuthGuard)`, jamais de garde JWT organisationnelle sur cette route
- [ ] Tâche 4 : `apps/trust-api/src/organizations/organizations.module.ts` — câblage du nouveau guard si nécessaire (provider)
- [ ] Tâche 5 : `.env.example` — documenter `DGI_VERIFICATION_INTERNAL_KEY` (même commande de génération que les autres secrets)

## Tests à écrire AVANT le code
- [ ] Test 1 : `organizations.service.spec.ts` — `verifyDgi` passe `unverified → verified` quand NIF+eTax présents
- [ ] Test 2 : `organizations.service.spec.ts` — `verifyDgi` lève `ConflictException` explicite quand `nif`/`etaxNumber` absents (jamais un 500 brut)
- [ ] Test 3 : `organizations.service.spec.ts` — `verifyDgi` sur une organisation déjà `verified` est idempotent (pas d'erreur, statut inchangé)
- [ ] Test 4 : `dgi-verification-auth.guard.spec.ts` — rejette une clé absente/invalide, accepte la bonne clé (mirroir des tests d'`internal-auth.guard.spec.ts`)
- [ ] Test 5 : `organizations.controller.spec.ts` (si un tel fichier existe déjà, sinon E2E) — la route `verify-dgi` est bien protégée par le nouveau guard, pas par le JWT organisationnel

## Critères de done
- Tous les tests verts (suite complète, pas seulement les nouveaux)
- Build/lint/typecheck verts
- Aucune donnée sensible (NIF/eTax) loggée
- Aucun secret hardcodé — `DGI_VERIFICATION_INTERNAL_KEY` fail-fast au boot comme les autres
- Vérification E2E réelle : org sans NIF → `verify-dgi` refusé (409) ; org avec NIF+eTax → `verify-dgi` accepté → `dgiVerificationStatus: verified` confirmé en relisant l'organisation ; re-appel → idempotent
- `dev-code-reviewer` OK
- `dev-security-reviewer` OK (NIF/eTax en jeu)

## Risques identifiés & mitigations
- **Risque** : confondre le secret de vérification DGI avec un secret inter-service existant → élévation de privilège croisée entre bounded contexts. **Mitigation** : secret strictement dédié, jamais partagé.
- **Risque** : vérifier une organisation sans NIF/eTax, cassant l'invariant ADR-035 (NIF/eTax jamais partiels). **Mitigation** : garde explicite avant toute transition, testée en premier (RED confirmé sur ce cas avant tout autre).
- **Risque** : re-vérification non idempotente créant un comportement surprenant en cas de double appel (retry réseau). **Mitigation** : test dédié à l'idempotence.
