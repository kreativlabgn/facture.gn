# Plan : /register ignore returnTo pour un visiteur déjà connecté (2026-09-17)

## Contexte

La carte « Espace cabinet » de la landing (`/`) et du hub `/inscription`
(`lib/espaces.ts`) propose « Inscrire mon cabinet » → `/register?returnTo=/nouveau-cabinet`.
Le tunnel suppose un visiteur SANS compte : `/register` crée le compte, puis
`registerAction` honore `returnTo` (validé par `destinationInterne`) pour
l'envoyer créer sa structure de cabinet.

## Problème

`register/page.tsx` court-circuite ce tunnel pour qui a DÉJÀ un compte :

```ts
if (await getSessionToken()) {
  redirect("/dashboard");
}
```

Un utilisateur déjà connecté (ex. un marchand qui vient de créer sa boutique)
qui clique « Inscrire mon cabinet » atterrit sur `/register?returnTo=/nouveau-cabinet`,
la garde détecte sa session, ignore `returnTo`, et le renvoie sur `/dashboard`
— sa boutique. Rien ne le justifie : il a déjà le compte requis (même type de
compte pour marchand et cabinet, cf. commentaire d'`espaces.ts`), il lui
manque seulement la structure `ProfessionalPractice`. Aucun test ne couvre ce
cas (`register/page.tsx` n'a pas de spec).

La garde reste nécessaire pour éviter de soumettre le FORMULAIRE (créerait un
second compte sur un autre numéro) — le problème n'est que la redirection de
la page elle-même quand `returnTo` est présent et sûr.

## Solution retenue

Dans `register/page.tsx`, quand une session existe déjà : rediriger vers
`returnTo` (validé par `destinationInterne`, déjà utilisé par
`registerAction` et `route-protection.ts` — même garde anti-open-redirect
partout) plutôt que systématiquement `/dashboard`. Sans `returnTo`,
comportement inchangé (`/dashboard`).

Le formulaire lui-même n'est jamais rendu dans ce cas (retour anticipé), donc
aucun risque de double création de compte : on ne fait que sauter l'étape
« créer un compte », déjà satisfaite.

## Fichiers et tâches

- `apps/web/src/app/(entree)/register/page.tsx` — redirection conditionnelle
  via `destinationInterne`.
- `apps/web/src/app/(entree)/register/page.spec.tsx` (nouveau) — couvre la
  redirection déjà-connecté avec/sans `returnTo`, et le rejet d'un `returnTo`
  externe (`https://evil.com`) qui doit retomber sur `/dashboard`.

## Tests avant code (RED → GREEN)

1. Session active + `returnTo=/nouveau-cabinet` → redirige vers `/nouveau-cabinet`.
2. Session active + `returnTo=/cabinet` → redirige vers `/cabinet`.
3. Session active sans `returnTo` → redirige vers `/dashboard` (comportement existant, non-régression).
4. Session active + `returnTo` externe (`https://evil.com`, `//evil.com`) → retombe sur `/dashboard` (anti-open-redirect).
5. Pas de session → page rendue normalement (non-régression, pas de redirect).

## Critères de done

- Les 5 cas ci-dessus verts.
- `pnpm --filter web lint typecheck test` passent.
- Aucune régression sur `register/actions.spec.ts` (comportement de soumission inchangé).

## Risques et limites

- Portée volontairement limitée à ce seul point d'entrée : un sweep statique
  séparé (`redirect(` / `returnTo` dans tout `apps/web/src`) vérifie qu'aucun
  autre écran ne reproduit la même classe de bug (session active qui avale un
  `returnTo` légitime) — traité indépendamment, pas dans ce diff.
- Changement dans le chemin d'authentification : revues répétées jusqu'à un
  « solide » explicite (CONTRIBUTING.md §Workflow imposé, point 5).
