# Plan : Taux de paiements vérifiés sur le dashboard PME (E8)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : frontend uniquement (`apps/web`) — `GET /organizations/:id/trust-score` existe déjà côté trust-api (`organizations.controller.ts`, story E8/ADR-093), aucune UI ne l'affiche.
- Persona affecté : owner/admin de l'organisation (seuls rôles autorisés par `@Roles("owner", "admin")` sur cette route — "strictement informatif, interne à l'organisation... jamais exposé à un tiers externe au MVP", commentaire du contrôleur).
- Données sensibles : montants agrégés — même sensibilité que le reste du dashboard, pas de nouvelle catégorie.

## Investigation préalable

`OrganizationsService.getVerifiedPaymentRatio()` retourne `{ totalAmount, verifiedAmount, ratio }` — `ratio` est `null` tant qu'aucun paiement n'existe (`totalAmount === 0n`), jamais une division par zéro silencieuse. Route déjà restreinte owner/admin — même audience que `GET /organizations/:id` déjà utilisé par `settings/page.tsx`, qui gère déjà proprement un 403.

## Décision d'architecture

Ajout dans `settings/page.tsx` (pas un nouvel écran séparé — c'est une donnée "à propos de mon organisation", même famille que le reste de cette page) : un second appel `getTrustScore(token, organization.id)` dans le même bloc `try/catch` déjà en place pour `getOrganization()` (même garde 403, un seul message d'erreur déjà correct pour les deux). Affichage : pourcentage si `ratio` non-null, message explicite "Pas encore de paiement enregistré" si `null` — jamais un `0%` qui laisserait croire à un mauvais score.

## Alternatives écartées

**Nouvel écran dédié `/dashboard/trust-score`** — écarté, une seule donnée informative ne justifie pas un écran séparé ni une entrée de nav supplémentaire ; cohérent avec la densité déjà pratiquée sur `settings/page.tsx`.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `src/lib/trust-api.ts` — `getTrustScore(token, organizationId)`
- [ ] Tâche 2 : `settings/page.tsx` — appel groupé avec `getOrganization`, section d'affichage

## Critères de done
- typecheck + lint + build verts
- `ratio === null` affiche un message explicite, jamais "0%"

## Risques identifiés & mitigations
- Aucun — lecture seule d'un endpoint déjà existant et déjà testé côté trust-api.
