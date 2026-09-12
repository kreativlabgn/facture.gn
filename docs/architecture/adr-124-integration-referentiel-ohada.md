# ADR-124 : Référentiel OHADA et dénominations DGI des régimes fiscaux

> **Numérotation.** ADR-123 est pris par le cadrage du partenariat FODIP
> (`docs/plans/2026-09-12-adr123-cadrage-partenariat-fodip.md`). 124 est le
> premier libre.
>
> Contraint par ADR-033 (taux de TVA résolu depuis le régime, jamais saisi),
> ADR-057 (régime associatif réservé aux associations), ADR-077 (seule route
> versionnée du dépôt) et ADR-122 (double-garde OCR, écart `TVA_REGIME`).
> Décisions 1 et 3 posées ; décision 2 **ouverte**, à trancher en comité.

## Statut

Proposé — 12 septembre 2026. En discussion. Aucune ligne de code n'est
engagée par ce texte : il fixe ce qui est décidé, isole ce qui ne l'est pas,
et donne au Sponsor les deux alternatives de la décision 2 avec leur coût.

## Contexte

Le cahier des charges d'onboarding de la Vague 4 (DGI) demande de collecter,
à la création d'une organisation, deux informations nouvelles :

- la **forme juridique** selon la taxonomie OHADA — SARL, SA, EI, et les
  autres formes de l'Acte uniforme sur les sociétés commerciales ;
- une **dénomination de régime fiscal** telle que la DGI la nomme — « Réel
  Normal », « Régime Simplifié d'Imposition (RSI) », « TPU ».

Une maquette a circulé qui réalisait cette collecte en remplaçant les enums
existants et en exposant une route `POST /v1/organizations/onboarding`. Elle
a été confrontée au dépôt le 12 septembre ; trois contradictions en sont
sorties, qui structurent ce texte.

Ce que le dépôt porte aujourd'hui, et qui fait foi :

| Élément | Où | Valeurs |
|---|---|---|
| `LegalForm` | `schema.prisma:77` | `commercial`, `association` |
| `RegimeFiscal` | `schema.prisma:70` | `normal_tva`, `tpu`, `normal_sans_tva`, `non_assujetti_association` |
| Taux de TVA par régime | `invoices/tax-regime.ts` | 1 800 bps / 0 / 0 / 0 |
| Code de déclaration e-Tax | `etax/etax-declaration.ts` | `TVA-18` / `TPU` / `HORS-TVA` / `EXO-ASSO` |
| Libellés affichés | `web/src/lib/fiscal.ts` (`REGIME_FISCAL_LABELS`) | un par valeur |
| Règle associative | `create-organization.dto.ts:28` (`.refine`) | `non_assujetti_association` ⇒ `legalForm = association` |
| Garde OCR | `ai/ocr-validation.service.ts` | écart `TVA_REGIME` si la TVA lue ≠ celle du régime |
| Création d'organisation | `POST /organizations` | `ZodValidationPipe(createOrganizationSchema)` |

## Les trois contradictions

### C1 — La forme juridique OHADA n'est pas `LegalForm`

`LegalForm` ne décrit pas la forme juridique : il distingue un **assujetti
commercial** d'une **association**, et n'existe que pour porter la règle
d'ADR-057 (une association seule peut être `non_assujetti_association`). Une
SARL, une SA et une EI sont toutes trois `commercial`. Remplacer `LegalForm`
par la taxonomie OHADA ferait disparaître la valeur `association` dont dépend
le `.refine` du DTO, ou obligerait à dériver « association » d'une liste de
formes juridiques — c'est-à-dire à réécrire ADR-057 par effet de bord.

Les deux informations sont **orthogonales** : l'une dit ce que l'entité est
au sens de l'Acte uniforme, l'autre dit comment elle se situe face à la TVA.

### C2 — « Réel Normal » et « RSI » n'ont pas de sémantique dans le moteur

`RegimeFiscal` n'est pas une étiquette : chaque valeur est une **clé** dans
trois tables `Record<RegimeFiscal, …>` — le taux de TVA (ADR-033), le code
e-Tax, le libellé — et un **discriminant** de la double-garde OCR. Le type
`Record` est exhaustif : ajouter une valeur à l'enum sans la renseigner dans
chacune des tables est une erreur de compilation, à dessein.

« Réel Normal » recouvre vraisemblablement `normal_tva` *et*
`normal_sans_tva` (un assujetti au réel collecte ou non la TVA selon son
activité) : ce n'est pas une valeur, c'est une **famille**. « RSI » n'a
aujourd'hui **aucun** comportement défini : ni taux, ni code e-Tax, ni règle
OCR. L'ajouter comme chaîne, c'est ajouter un régime dont la TVA est
indéterminée — précisément ce qu'ADR-033 interdit (« jamais un taux TVA
plat », et a fortiori jamais un taux absent). « TPU » existe déjà.

### C3 — `/v1/` est une exception motivée, pas un patron

L'API de trust-api est plate et non versionnée. La seule route en `/v1/` est
`POST /v1/partners/:partnerType/:event`, et le plan du 10 août le note
explicitement : « premier endpoint versionné de ce repo, divergence assumée
[…] car imposée par l'ADR [077] lui-même ». Aucun ADR n'impose de préfixe à
l'onboarding. Le versionner créerait une seconde exception sans motif, et
laisserait croire qu'une politique de versionnage existe.

## Décisions

### 1. Forme juridique OHADA : un champ nouveau, `LegalForm` intact

Un champ `formeJuridiqueOhada` est ajouté au modèle `Organization`, porté par
un enum Prisma dédié `FormeJuridiqueOhada`. `LegalForm` n'est ni renommé, ni
étendu, ni dérivé. Les deux champs coexistent ; la règle d'ADR-057 continue de
s'appuyer sur `LegalForm` seul.

- **Nullable, sans valeur par défaut.** Les organisations existantes n'ont
  pas cette information et personne ne doit l'inventer pour elles. Le champ
  devient obligatoire dans le DTO de création à partir de la Vague 4 ; il
  reste nullable en base tant qu'un rattrapage n'a pas été fait.
- **Liste fermée, à fixer en comité.** L'Acte uniforme en nomme plus que
  trois. La liste retenue est celle du cahier des charges DGI, pas une
  sélection faite dans ce dépôt. Une valeur `autre` n'est **pas** prévue :
  une forme absente de la liste est une question au Sponsor, pas une case.
- **Cohérence avec `LegalForm`** : une `association` OHADA (association
  déclarée, loi guinéenne) n'est pas une société commerciale. Le DTO
  vérifiera que `legalForm = association` ⇔ `formeJuridiqueOhada ∈ {formes
  associatives}`, par un second `.refine` à côté de celui d'ADR-057.
- **Aucune incidence** sur la TVA, l'e-Tax, la PDP, la RLS ou l'OCR : ce
  champ est descriptif. Il n'entre dans aucun `Record<…>` exhaustif.

### 2. Dénominations DGI des régimes : **ouvert** — deux alternatives

Ce que ce texte **décide** : les chaînes « Réel Normal », « RSI » ne sont pas
ajoutées à `RegimeFiscal` sans qu'un comportement fiscal complet leur ait été
défini (taux, code e-Tax, règle OCR, position PDP / Z de caisse). Ce qu'il
**laisse au comité** : laquelle des deux voies suivantes.

**Alternative A — alias d'affichage.** `RegimeFiscal` reste tel quel en base
et dans le moteur. Les dénominations DGI deviennent une **projection** :
une table `Record<RegimeFiscal, string>` de libellés DGI, à côté de
`REGIME_FISCAL_LABELS`, et dans le formulaire d'onboarding un choix
présenté avec les mots de la DGI mais dont la valeur soumise est celle de
l'enum. « Réel Normal » devient un groupe d'options (`normal_tva`,
`normal_sans_tva`) ou une question en deux temps (« au réel ? » puis
« collectez-vous la TVA ? »).

- Coût : quelques lignes web, aucun schéma, aucune migration, aucun impact
  moteur. Livrable en une tranche.
- Limite : **RSI n'a pas de cible.** Aucune valeur existante n'est le RSI.
  L'alternative A ne le résout pas ; elle l'exclut du formulaire jusqu'à ce
  que l'alternative B lui donne un contenu, ou que le comité constate que le
  RSI n'a pas à être distingué sur une facture.

**Alternative B — extension de l'enum.** `RegimeFiscal` gagne `rsi` (et, si
le comité le décide, `reel_normal` en remplacement des deux valeurs
`normal_*`). Chaque valeur ajoutée doit être renseignée dans les trois tables
exhaustives et traitée par la double-garde OCR, la déclaration e-Tax, la
passerelle PDP et l'apurement des Z de caisse (ADR-119, dont HT_FIRST n'est
pas le discriminant — la même prudence s'applique ici).

- Prérequis absolu : la **définition fiscale** du RSI — quel taux de TVA une
  facture émise sous RSI porte-t-elle, et quel code la DGI attend-elle en
  déclaration. Ce dépôt ne la connaît pas ; DAT §12 ne la nomme pas. Elle
  vient du cahier des charges ou de la DGI, jamais d'une supposition.
- Coût : migration d'enum, étude d'impact sur `TVA_REGIME` (une facture RSI
  lue par le Hub Vision doit produire le bon « attendu »), rattrapage des
  lignes PDP déjà écrites si `normal_*` fusionnent (le précédent d'ADR-108
  a montré que ce rattrapage n'est pas gratuit), et mise à jour de tous les
  tests qui énumèrent les régimes.
- Interdit : fusionner `normal_tva` et `normal_sans_tva` sans conserver la
  distinction « collecte la TVA / ne la collecte pas ». Le code e-Tax en
  dépend (`TVA-18` contre `HORS-TVA`) : « fondre en un seul code produirait
  des déclarations formellement fausses » (`etax-declaration.ts:15`).

**Recommandation de l'architecture** : A immédiatement, B seulement si la DGI
fournit la définition fiscale du RSI — et alors comme un ADR propre, pas comme
un amendement de celui-ci.

### 3. Pas de `/v1/` ; une seule voie de création d'organisation

La collecte des nouveaux champs n'est pas versionnée. Elle **n'ouvre pas de
route nouvelle** : `POST /organizations` *est* l'onboarding — c'est la route
que le tunnel `/onboarding` appelle, celle qui porte le `.refine` d'ADR-057,
et celle que le webhook APIP et l'onboarding assisté contournent chacun par
une route explicitement distincte. Les champs de la Vague 4 s'ajoutent à
`createOrganizationSchema`, et le formulaire `(auth)/onboarding` les collecte.

Une route parallèle `POST /organizations/onboarding` — envisagée dans la
proposition initiale — créerait une seconde façon de créer une organisation,
donc un second endroit où faire respecter ADR-057 et la décision 1. Elle est
écartée, sauf si le comité identifie un besoin qu'un ajout de champs ne
couvre pas.

## Conséquences

- La maquette du 12 septembre (`OnboardingForm` + `onboarding.schema.ts` +
  contrôleur `v1/organizations`) n'est pas intégrée. Le formulaire réel
  (`(auth)/onboarding/OnboardingForm.tsx`) et le DTO réel sont les points
  d'extension.
- Tant que la décision 2 n'est pas prise, **aucune chaîne « RSI » n'entre
  dans le dépôt**, ni en base, ni en libellé.
- La décision 1 seule est implémentable sans attendre : enum, colonne
  nullable, champ de DTO, `.refine` de cohérence, sélecteur dans le
  formulaire. Elle fera l'objet d'une note de réalisation dans `docs/plans/`.

## Vérification

À la livraison de la décision 1 :

- `create-organization.dto.spec.ts` : une `association` avec une forme OHADA
  commerciale est refusée, et l'inverse ; une organisation existante sans
  forme OHADA reste lisible.
- `fiscal.spec.ts` (web) : `allowedRegimesFor` est inchangé — la forme OHADA
  ne filtre pas les régimes.
- Aucun `Record<RegimeFiscal, …>` n'a changé de clés (`tsc` le garantit).

À la livraison de l'alternative A, si retenue : la valeur soumise par le
formulaire est toujours une valeur de `RegimeFiscal`, jamais un libellé DGI
(test de l'action serveur).

## Alternatives écartées

- **Remplacer `LegalForm` par la taxonomie OHADA.** Casse ADR-057 ou oblige à
  le dériver. Voir C1.
- **Ajouter « REEL » et « RSI » comme chaînes libres dans `RegimeFiscal`.**
  Une valeur d'enum sans taux ni code e-Tax est une facture à la TVA
  indéterminée. Voir C2.
- **`POST /v1/organizations/onboarding`.** Exception de versionnage sans
  motif et route de création parallèle. Voir C3 et décision 3.
- **Un `safeParse` manuel dans le contrôleur.** `ZodValidationPipe` rend déjà
  un 400 structuré ; dupliquer la validation dans le handler est une seconde
  source de vérité.

## Reste ouvert

1. **La liste OHADA retenue** (décision 1) : quelles formes, sous quels codes.
   Cahier des charges DGI à fournir au comité.
2. **La décision 2** : A ou B — et, pour B, la définition fiscale du RSI.
3. **Rattrapage des organisations existantes** : la forme OHADA leur est-elle
   demandée à la prochaine connexion, saisie par le cabinet mandataire, ou
   laissée vide ? Question produit, pas d'architecture.
