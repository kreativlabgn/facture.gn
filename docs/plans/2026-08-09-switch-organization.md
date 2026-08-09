# Plan : Switcher entre organisations depuis le dashboard cabinet/CGA (F7)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `practices/` (F4) + `mandates/` (F5/F1/F6, mergées), aucun nouveau modèle
- Persona affecté : collaborateur d'un cabinet/CGA (`practice_admin` ou `accountant_external`, ADR-070) qui gère plusieurs organisations clientes et doit passer de l'une à l'autre
- Données sensibles manipulées : aucune nouvelle (liste de noms d'organisations déjà accessibles par mandat)
- Impact réglementaire : aucun direct

## Investigation préalable
Backlog (texte complet, aucun bullet) : "F7 — Switcher entre organisations depuis le dashboard cabinet/CGA `[MUST]`." Aucune réf ADR explicite sur la ligne elle-même — recherche croisée nécessaire.

**Découverte n°1 (ADR-070)** : "Scope MVP réduit (consultation + FEC + switch). Fonctionnalités avancées en V1." — confirme que F7 fait partie du triptyque MVP `accountant_external`, aux côtés de F9 (FEC, à venir) et de la simple consultation. Important : **`accountant_external` doit pouvoir switcher, pas seulement `practice_admin`** — contrairement à F5/F6 (actions administratives engageant le cabinet), F7 est une action de consultation quotidienne.

**Découverte n°2, bloquante pour le scope littéral (DAT §7.2)** : "Vue transversale sur toutes les organisations mandatées. Switch <1s sans rechargement. **Isolation RLS : SET app.current_practice**." Ce mécanisme (Postgres Row-Level Security, variable de session `SET app.current_practice`) n'existe **nulle part** dans ce repo (grep exhaustif sur `packages/db` et `apps/` : zéro `ROW LEVEL SECURITY`, zéro `current_practice`). Toute l'autorisation construite cette session (`RolesGuard`, vérifications en ligne F5/F1/F6) repose sur un modèle **stateless** (JWT + requête DB par appel, jamais de session serveur — cf. `AuthTokenService` : "le rôle n'est jamais mis en cache dans le JWT, toujours résolu ici à la requête"). Une RLS à variable de session suppose une affinité de connexion DB par requête HTTP, incompatible avec ce modèle stateless déjà établi partout ailleurs. Construire une vraie RLS ici serait une brique d'infrastructure entièrement nouvelle, jamais utilisée dans ce repo, disproportionnée pour cette story.

**Découverte n°3, bloquante pour le scope littéral** : "depuis le dashboard cabinet/CGA" présuppose un dashboard existant à l'intérieur duquel switcher. Grep exhaustif de `apps/trust-api/src` : **seulement 2 routes `@Get()` existent dans tout le Trust Context** (`GET /organizations/:id/trust-score`, E8 ; `GET /verify/:certificationId`, public). Aucun endpoint de listing/consultation (factures, paiements, avoirs...) n'existe pour AUCUNE organisation, pas même pour son propre owner. Le "dashboard cabinet/CGA" lui-même n'a donc aucune donnée à afficher aujourd'hui, quel que soit le mécanisme de switch choisi.

**Décision de scope** : F7 se limite au **prérequis backend concret et testable que toute UI de switch doit consommer** — la liste des organisations effectivement accessibles à une practice via un mandat `active`. Le "switch" en tant que tel (changer de contexte d'affichage) devient un problème purement client (PWA/dashboard), cohérent avec l'architecture stateless déjà en place : chaque requête ultérieure identifie déjà l'organisation ciblée par son `:id` dans l'URL (comme toutes les routes existantes), aucun état "organisation courante" ne doit être maintenu côté serveur. RLS et dashboard de consultation restent des stories futures distinctes, non couvertes ici (même raisonnement que l'exclusion Djomy Payout de C13, ou USSD PIN de F5).

## Problème (en 3 lignes max)
Un mandat `active` (F1) prouve qu'un cabinet a accès à une organisation, mais rien ne permet à un collaborateur du cabinet de découvrir QUELLES organisations lui sont accessibles — la donnée nécessaire à tout sélecteur "switch" n'existe nulle part.

## Solution retenue (en 5 lignes max)
`GET /practices/:id/organizations` — nouvelle route sur `PracticesController` existant (F4), déléguant à une nouvelle méthode `MandatesService.listAccessibleOrganizations(practiceId, requesterUserId)`. Autorisation : tout `PracticeMember` actif (`leftAt: null`) de la practice — **pas restreint à `practice_admin`**, contrairement à F5/F6, car ADR-070 exige explicitement que `accountant_external` puisse consulter/switcher. Retourne les mandats `active` de la practice avec l'organisation associée (`id`, `name`) — suffisant pour peupler un sélecteur, sans exposer de données financières.

## Alternatives écartées
Construire une RLS Postgres avec `SET app.current_practice` (DAT §7.2) — écartée : aucune infrastructure RLS n'existe dans ce repo, incompatible avec le modèle stateless déjà utilisé par toute l'autorisation existante (`RolesGuard`, vérifications en ligne). Construire un dashboard de consultation (factures/paiements par organisation) dans la foulée — écartée : aucun endpoint de listing n'existe même pour un owner direct, story bien plus large que "switcher", hors scope MUST de F7 isolément. Restreindre l'accès à `practice_admin` (comme F5/F6) — écartée : ADR-070 nomme explicitement `accountant_external` comme devant pouvoir consulter/switcher au MVP, une restriction admin-only rendrait la story inutilisable pour son persona principal (Mamadou et ses collaborateurs).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/mandates/mandates.service.ts` — ajoute `listAccessibleOrganizations(practiceId, requesterUserId)` : vérifie tout `PracticeMember` actif (pas de restriction de rôle), puis `mandate.findMany({where: {practiceId, status: "active"}, include: {organization: {select: {id, name}}}})`
- [ ] Tâche 2 : `apps/trust-api/src/practices/practices.module.ts` — importe `MandatesModule` (déjà exporte `MandatesService`)
- [ ] Tâche 3 : `apps/trust-api/src/practices/practices.controller.ts` — ajoute `GET :id/organizations`, injecte `MandatesService`, `@CurrentUser()` pour le demandeur

## Tests à écrire AVANT le code
- [ ] Test 1 (`mandates.service.spec.ts`) : retourne les organisations dont le mandat est `active` pour cette practice
- [ ] Test 2 : exclut les mandats `pending`/`revoked`/`expired` de la liste
- [ ] Test 3 : refuse si l'appelant n'est pas `PracticeMember` de la practice ciblée
- [ ] Test 4 : accepte un `accountant_external` (pas seulement `practice_admin`) — contrairement à `create()`/`revoke()`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune migration Prisma nécessaire
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : confusion future avec F5/F6 sur qui peut appeler quoi (`practice_admin` vs tout membre) → mitigation : commentaire explicite dans le service référençant ADR-070, distinct des gardes `assertPracticeAdmin()` réutilisées par F5/F6.
- Risque 2 : le scope réduit (liste seulement, pas de vraie "vue transversale" ni RLS) pourrait sembler incomplet face au texte DAT §7.2 → mitigation : documenté explicitement ci-dessus comme le scope MVP concret et testable, RLS/dashboard restant des stories futures.
