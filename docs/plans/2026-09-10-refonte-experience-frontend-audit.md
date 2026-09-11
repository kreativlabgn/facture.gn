# Plan : Refonte de l'exp�rience frontend apr�s audit (2026-09-10)

## Contexte

Le d�p�t contient d�j� des changements locaux sur l'accueil, l'inscription, le cabinet, le dashboard marchand et la protection des routes. Ils sont conserv�s et doivent �tre compl�t�s sans r��crire les contrats de `trust-api` ni inventer de donn�es m�tier. La source de v�rit� de marque est `globals.css` et `layout.tsx` : navy `#0B1D3A`, jaune `#F2B705`, gris `#F5F7F9`, Poppins/Inter/JetBrains Mono, sans d�grad� ni vocabulaire d'autorit� publique.

## Probl�me

Les parcours publics et authentifi�s ne forment pas encore une exp�rience continue : les CTA doivent rejoindre des routes r�elles, le retour apr�s login doit �tre interne et conserv�, `/nouveau-cabinet` doit �tre prot�g� comme ses actions, et les vues marchand/cabinet doivent exposer une prochaine action compr�hensible. Plusieurs d�tails d'accessibilit�, de responsive et de tokens peuvent encore faire �chouer la CI ou un usage mobile.

## Solution retenue

- garder une landing orient�e confiance priv�e, �mission, partage, encaissement et v�rification ;
- utiliser les donn�es et permissions d�j� expos�es par `trust-api`, avec des libell�s explicites lorsqu'une agr�gation n'existe pas ;
- centraliser la validation des destinations internes et aligner proxy/tests ;
- structurer inscription/onboarding par persona puis premi�re action ;
- organiser les dashboards autour des actions � traiter et de preuves lisibles ;
- appliquer les tokens et r�gles de focus/labels/overflow sans ajouter de fonctionnalit� backend ;
- harmoniser les manifests sur `pnpm@10.34.5`, version racine compatible avec le lockfile et la CI, sans r�g�n�rer arbitrairement le lockfile.

## Fichiers et t�ches

1. `apps/web/src/lib/route-protection.ts`, `proxy.ts`, login/register : valider `returnTo`, prot�ger les routes, pr�server la destination et tester les cas externes, protocol-relative et query string.
2. `apps/web/src/app/page.tsx`, espaces publics et auth : clarifier les CTA, supprimer les formulations institutionnelles, v�rifier les routes r�elles, et rendre les �tapes/erreurs accessibles.
3. `apps/web/src/app/(app)/dashboard`, `apps/web/src/app/cabinet` et composants shell : corriger les actions prioritaires, �tats vides, responsive, d�tail organisation, tiroir born� et navigation mobile.
4. `apps/web/src/app/globals.css`, `layout.tsx` et composants UI : aligner les tokens/polices, supprimer les classes interdites et renforcer headings, labels et focus.
5. Tests web cibl�s : protection/returnTo, CTA et guardrails structurels ; compl�ter les tests de parcours disponibles sans ajouter une d�pendance E2E lourde si Playwright/axe n'est pas install�.
6. Manifests/CI : corriger la version pnpm d�clar�e puis ex�cuter lint, typecheck, tests, build et audit-ci ; diagnostiquer s�par�ment les services externes absents.

## Tests avant code

- `apps/web/src/lib/route-protection.spec.ts` : destination interne seulement, `/nouveau-cabinet` et `/onboarding` prot�g�s, `/cabinet/register` public.
- tests de guardrails sur landing/CTA et r�gles de marque existants ; ajouter seulement les assertions manquantes.
- tests cibl�s des actions login/register/onboarding existants.

## Crit�res de done

- aucun CTA public ne m�ne vers une route absente ;
- aucune destination de redirection ne permet un open redirect ;
- chaque �cran principal poss�de un heading, un �tat erreur/vide exploitable, des contr�les nomm�s et un affichage mobile sans d�bordement ;
- donn�es cabinet/marchand exactes et permissions inchang�es ;
- `pnpm --filter @facture-gn/web lint`, `typecheck`, `test` et `build` passent, puis les validations globales disponibles sont ex�cut�es ;
- aucune modification destructive des changements d�j� pr�sents et aucun commit.

## Risques et limites

- le backend ne fournit pas toujours le nom d'une organisation dans le d�tail cabinet : l'interface doit utiliser le nom d�j� connu ou signaler son absence, sans appeler un endpoint r�serv� ;
- les validations n�cessitant Postgres/Redis ou secrets peuvent �tre bloqu�es par l'environnement local ; elles seront rapport�es pr�cis�ment.