# Chantier 4 — Commande publique Telemo & portail DAF

## Contexte
Le dépôt contient déjà des champs B2G sur la facture, mais pas le dossier de commande publique ni le rattachement Telemo demandé.

## Solution
Ajouter `B2GCaseStatus`, les modèles `TelemoAward`, `B2GCase` et `OcaecgLicense`, puis leurs relations sur `Organization` et `Invoice`. Écrire une migration SQL manuelle avec les contraintes d'unicité, les clés étrangères et les index du schéma Prisma.

## Tests et vérifications
- `pnpm --filter @facture-gn/db db:generate`
- `pnpm --filter @facture-gn/db build`
- `pnpm --filter @facture-gn/web typecheck` n'est pas requis: changement limité à la base partagée.
- Vérifier les erreurs Prisma et le diff de migration.

## Risques
- La migration doit respecter les tables et enums PostgreSQL déjà générés.
- Les nouvelles relations sont structurelles; aucun endpoint métier n'est ajouté dans ce chantier.

## Critères de done
- Le schéma Prisma valide et expose les trois modèles.
- Les relations `Organization`/`Invoice` sont bidirectionnelles et compilables.
- La migration est écrite à la main et cohérente avec le schéma.
