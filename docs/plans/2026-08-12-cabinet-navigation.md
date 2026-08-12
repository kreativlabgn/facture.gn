# Plan : Menu de navigation du dashboard cabinet

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : frontend uniquement (`apps/web`), `cabinet/layout.tsx`.
- Persona affecté : tout personnel de cabinet comptable/gestionnaire/fiduciaire/CGA.
- Données sensibles : aucune nouvelle.

## Investigation préalable

Les trois tâches précédentes de cette feuille de route ont construit `cabinet/organizations/[organizationId]` (+ FEC), `cabinet/members`, `cabinet/mandates` — mais `cabinet/layout.tsx` n'a toujours aucun `NAV_ITEMS` (contrairement à `dashboard/layout.tsx`), donc aucun lien visible vers ces écrans en dehors de la page d'accueil elle-même. C'est la dernière pièce manquante pour que le dashboard cabinet soit un ensemble navigable, pas une collection de pages isolées atteignables seulement par URL directe.

Pas de "sélecteur d'organisation" séparé à construire (F7) : `cabinet/page.tsx` liste déjà toutes les organisations accessibles avec un lien direct vers chacune — c'est déjà le mécanisme de switch, un dropdown global serait une deuxième façon de faire la même chose.

## Décision d'architecture

`cabinet/layout.tsx` reçoit un `NAV_ITEMS` identique en forme à celui de `dashboard/layout.tsx` :
```ts
const NAV_ITEMS = [
  { href: "/cabinet", label: "Organisations" },
  { href: "/cabinet/mandates", label: "Mandats" },
  { href: "/cabinet/members", label: "Collaborateurs" },
];
```
Aucune autre logique — copie directe du pattern déjà validé côté PME.

## Alternatives écartées

**Un sélecteur d'organisation dans le header** (dropdown global) — écarté, redondant avec la liste déjà affichée sur `/cabinet` (voir investigation ci-dessus).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `cabinet/layout.tsx` — ajoute `NAV_ITEMS` + rendu `<nav>` (copie du bloc déjà existant dans `dashboard/layout.tsx`)

## Critères de done
- typecheck + lint + build verts
- Les trois liens mènent à des routes existantes (aucun 404)

## Risques identifiés & mitigations
- Aucun — changement UI pur, aucune nouvelle donnée ni logique.
