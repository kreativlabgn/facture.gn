# Plan : Middleware de protection des routes /dashboard et /cabinet

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Platform/Trust côté frontend (`apps/web`) — pas de nouveau module métier, correctif d'un gap d'infrastructure.
- Persona affecté : tout utilisateur PME ou cabinet/CGA accédant à `/dashboard/*` ou `/cabinet/*` sans session valide.
- Données sensibles manipulées : aucune donnée nouvelle — le bug concerne l'ACCÈS aux données déjà protégées côté trust-api (factures, clients, organisations).
- Impact réglementaire : aucun direct, mais un accès non redirigé proprement est un défaut de posture de sécurité basique.

## Investigation préalable

`apps/web/src/lib/session.ts:20-25` documente explicitement : *"Lève plutôt que de retourner null — appelé uniquement depuis des pages sous /dashboard, déjà protégées par middleware.ts (un appel ici sans cookie est un bug de câblage, pas un cas utilisateur normal à gérer silencieusement."* — l'intention de conception d'un `middleware.ts` est claire et documentée, mais **le fichier n'existe pas** dans `apps/web/` (vérifié : ni à la racine du projet Next.js, ni sous `src/`, absent de `git log --all -- '**/middleware.ts'`). En l'état, `requireSessionToken()` lève une `Error` non interceptée sur toute page sous `/dashboard` ou `/cabinet` visitée sans cookie `fg_session` — Next.js affiche une page d'erreur générique au lieu d'une redirection vers `/login`.

`apps/web` n'a aucune infrastructure de tests (pas de script `test` dans `package.json`, aucun fichier `*.spec.ts*`/`*.test.ts*`, aucun config vitest/jest) — contrairement à `trust-api`/`money-api` (suite Jest complète). Décision utilisateur : installer Vitest maintenant, appliquer TDD sur cette tâche et toute la suite de la feuille de route dashboards.

## Décision d'architecture

**Scope volontairement minimal** : le middleware vérifie uniquement la **présence** du cookie `fg_session`, jamais la validité du JWT RS256 lui-même. Justification :
- La validité du token est déjà strictement vérifiée à chaque appel API par `trust-api` (`JwtAuthGuard`) — un token présent mais expiré/invalide échoue déjà proprement sur le premier `authenticatedFetch()` (ex. `dashboard/settings/page.tsx` gère déjà un 403).
- Vérifier la signature RS256 dans le middleware nécessiterait soit une lib compatible edge runtime (`jose`, nouvelle dépendance), soit de forcer le runtime Node.js du middleware — complexité et surface de secret (distribuer `JWT_PUBLIC_KEY` à `apps/web`) disproportionnées pour un gain marginal (détecter un token expiré une requête plus tôt).
- Cohérent avec la discipline déjà pratiquée dans ce repo ("pas de données inventées plutôt qu'un chiffre fictif", cabinet/page.tsx) : ne pas construire un mécanisme de vérification dupliqué et partiel.

**Logique extraite en fonction pure testable** (`src/lib/route-protection.ts`), séparée du glue code `middleware.ts` (qui dépend de `next/server`, non testable unitairement sans mocker tout Next.js) :
```ts
export function resolveProtectedRouteRedirect(pathname: string, hasSession: boolean): string | null
```
- Retourne `"/login"` si `pathname` commence par `/dashboard` ou `/cabinet` et `hasSession` est `false`.
- Retourne `null` sinon (laisser passer) — y compris pour `/login` avec une session déjà active : **pas de redirection automatique loin de `/login`** dans cette passe (`LoginForm`/`loginAction` existants ne gèrent aucun paramètre `next`, et re-rediriger un utilisateur déjà connecté qui visite `/login` volontairement — ex. pour changer de compte — serait une surprise UX non demandée ; hors scope, cohérent avec le principe YAGNI déjà appliqué dans ce repo).

`middleware.ts` (racine `apps/web/`, à côté de `next.config.ts`) : lit le cookie `fg_session` via `request.cookies.get(SESSION_COOKIE_NAME)`, appelle `resolveProtectedRouteRedirect`, `NextResponse.redirect(...)` si non-null. `export const config = { matcher: ["/dashboard/:path*", "/cabinet/:path*"] }`.

## Alternatives écartées

**Vérification complète du JWT (signature + expiration) dans le middleware** — écartée pour cette tâche : nouvelle dépendance edge-compatible + nouveau secret partagé, disproportionné vu que trust-api revérifie déjà tout à chaque appel API. Peut devenir une tâche de suivi si un besoin réel émerge (ex. UX de redirection plus rapide sur token expiré).

**Rediriger `/login` → `/dashboard` si session déjà active** — écartée, aucun signal produit pour ce comportement, ajouterait une surprise UX non sollicitée.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/web/package.json` — ajouter `vitest`, `@vitejs/plugin-react` (pas nécessaire pour cette tâche mais posé pour les tâches suivantes de la feuille de route), script `"test": "vitest run"`
- [ ] Tâche 2 : `apps/web/vitest.config.ts` — config minimale (environment node, pas besoin de jsdom pour cette tâche précise)
- [ ] Tâche 3 (RED) : `apps/web/src/lib/route-protection.spec.ts` — cas : `/dashboard` sans session → `/login` ; `/cabinet/mandates` sans session → `/login` ; `/dashboard` avec session → `null` ; `/login` sans session → `null` ; `/` sans session → `null`
- [ ] Tâche 4 (GREEN) : `apps/web/src/lib/route-protection.ts` — implémentation
- [ ] Tâche 5 : `apps/web/middleware.ts` — glue Next.js (non testé unitairement, trop couplé au runtime edge — vérification manuelle en dev)

## Critères de done
- Suite Vitest verte (`pnpm --filter @facture-gn/web test`)
- `pnpm --filter @facture-gn/web typecheck` vert
- Vérification manuelle : visite de `/dashboard` sans cookie → redirection `/login` (pas de page d'erreur)
- Aucune donnée sensible (token) loggée dans le middleware

## Risques identifiés & mitigations
- Risque 1 : `config.matcher` mal formé laisserait passer des routes non protégées silencieusement → mitigation : vérification manuelle explicite de `/cabinet` en plus de `/dashboard` avant merge (pas seulement le cas testé unitairement).
- Risque 2 : édition future de `SESSION_COOKIE_NAME` dans `session.ts` sans répercussion dans `middleware.ts` (deux fichiers qui doivent rester synchronisés) → mitigation : `middleware.ts` importe la constante depuis `session.ts`, jamais une chaîne dupliquée.
