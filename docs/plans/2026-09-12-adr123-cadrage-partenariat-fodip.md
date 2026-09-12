# Plan : Cadrage du partenariat FODIP — double axe subvention & lecture macro (ADR-123)

## Contexte projet

Le FODIP (Fonds de Développement de l'Industrie et de la PME) finance un pilote
d'entrée des commerçants informels dans la facturation certifiée, appuyé sur le
Hub Vision (ADR-122) : la photo d'un carnet à souche devient un brouillon
certifiable sans ressaisie. Le fonds veut deux choses, et seulement deux :

1. **Une subvention adossée à une preuve d'usage** — ne payer que pour des
   commerçants qui facturent réellement par la plateforme, preuve à l'appui.
2. **Une lecture macro-économique du pilote** — combien de PME actives, quel
   volume certifié, quelle enveloppe consommée. En lecture seule, en agrégé.

Cette tranche livre le cadrage et une route de démonstration du parcours de
relecture. **Elle ne livre ni rôle, ni contrôleur, ni migration** : ce que
l'accès FODIP exige du modèle de données est décidé ci-dessous et sera
implémenté dans la tranche suivante, sur ce cadrage.

## Fil rouge — non négociable

**facture.gn est un tiers de confiance privé, jamais une autorité d'État.**
ADR-079 le pose pour la persona DGI, ADR-104 l'a fait respecter jusque dans le
nom d'un rôle (`dgi_readonly` → `tax_controller_readonly`). Le partenariat
FODIP est une convention d'appui et de subvention entre une plateforme privée
et un fonds public. Il ne fait pas de facture.gn un registre public, ne donne
au FODIP aucun droit sur le registre légal des factures, et n'ouvre aucune voie
fiscale parallèle : la transmission à la DGI reste celle de la passerelle PDP
(ADR-107), rien d'autre. Toute évolution de ce cadrage qui ferait lire au
fonds une facture nominative, ou écrire quoi que ce soit, est hors de l'ADR.

## Clarifications — ce que l'énoncé demandait et ce que le dépôt permet

**1. « Injecter un rôle `fodip_auditor` » ne peut pas vouloir dire une valeur
d'`OrganizationRole`.** `RolesGuard` (`common/rbac/roles.guard.ts`) ne connaît
pas de rôle global : il résout *une* organisation par requête, puis vérifie
l'appartenance dans `OrganizationMember`. Un rôle organisationnel FODIP
supposerait que le fonds soit membre de chaque PME du pilote — c'est
l'inverse d'une lecture transverse, et c'est exactement ce que
`tax_controller_readonly` n'est pas (« invité par l'organisation elle-même —
aucun rapport avec la persona institutionnelle », schema.prisma). Le FODIP est
une persona **hors tenant**. Son accès est donc une **exception transverse,
disjointe des gardes de tenants** : ni `@Roles()`, ni `RolesGuard`, ni
`OrganizationMember`.

**2. ADR-078 (« FODIP et 3AE restent hors plateforme, aucune intégration
technique ») est amendé, étroitement.** Le FODIP reste hors de la plateforme
*marchande* : aucun compte, aucun écran, aucune appartenance. Ce qui s'ouvre est
un **flux de synthèse** en lecture seule, exposé sous `/v1/partners/fodip/…`,
authentifié par la clé du `Partner` de type `fodip` déjà présent dans le
schéma. Le webhook APIP reste le seul flux *entrant* ; le flux FODIP est
*sortant* et agrégé. `partners.controller.ts:30` continue de refuser tout
événement entrant `fodip/*`.

**3. La RLS ne sait pas agréger entre tenants, et ne doit pas l'apprendre.**
Le cloisonnement livré (`docs/runbooks/rls-rollout.md`) pose
`set_config('app.organization_id', …)` à portée transaction : une
organisation à la fois. Ouvrir une lecture inter-PME au travers de la RLS
serait créer la brèche que la RLS ferme. La synthèse est donc **calculée hors
requête**, par un travail planifié qui tourne avec le client non scopé (le même
statut que le worker PDP), et **matérialisée** dans une table d'agrégats qui ne
contient aucune ligne rattachée à une organisation. La route FODIP lit cette
table, et seulement elle : elle ne touche jamais `invoice`, `organization` ni
`ocr_document`.

**4. La preuve d'usage est le registre `ocr_document`, pas la facture.** Ce qui
atteste qu'un commerçant *informel* est entré dans le circuit certifié par le
Hub Vision, c'est un scan qui a produit une facture émise : `OcrDocument` en
`AUTO_INSERTED` (ou relu à la main après `DRAFT_PENDING_MANUAL_REVIEW`) dont
le brouillon a atteint `issued`. Une facture saisie au clavier ne compte pas
dans le pilote — elle n'est pas ce que le fonds subventionne.

**5. Le chiffrage de la subvention n'est pas dans cette tranche.** Le barème
(forfait par PME activée, ou taux sur le volume certifié) relève de la
convention, pas du code. La synthèse expose les *compteurs* ; l'enveloppe
consommée est un montant en centimes, sérialisé en chaîne (BigInt, ADR-014),
calculé par un barème versionné que la convention fixera. Tant qu'il n'est pas
signé, le champ est absent de la réponse — pas simulé.

## Décisions

### Axe 1 — subvention adossée à la preuve d'usage

- Une PME est **active dans le pilote** sur une période si au moins une de ses
  factures `issued` sur la période provient d'un `ocr_document`.
- Le **volume certifié** d'une période est la somme des `totalTtcCentimes` des
  factures `issued` provenant d'un `ocr_document`, hors factures annulées
  (`voided`) — la leçon du KPI qui comptait les annulées vaut ici aussi.
- Le lien scan → facture est celui posé par ADR-122 (`OcrDocument.invoiceId`,
  ancre d'idempotence sur le brouillon). Aucune colonne nouvelle.

### Axe 2 — lecture macro en exception transverse

- Table `fodip_pilot_metrics` (période, `pmeActives`, `facturesPreuveUsage`,
  `volumeCertifieCentimes`, `calculeeLe`, `bareme` nullable). Une ligne par
  période close. Aucune clé étrangère vers `organization`. Écrite uniquement
  par le travail planifié, avec le client non scopé ; RLS activée sur la table
  avec une politique de lecture pour le rôle applicatif et aucune politique
  d'écriture pour lui.
- Route `GET /v1/partners/fodip/pilot-metrics`, hors `@Roles()`, gardée par un
  `PartnerApiKeyGuard` dédié qui exige un `Partner` de type `fodip` et une clé
  valide. `@Public()` n'est pas utilisé : la route n'est pas publique, elle est
  authentifiée autrement.
- La réponse est **agrégée seulement** : aucun identifiant, aucun nom, aucun
  NIF, aucune facture. Un compteur inférieur à 5 PME sur une période est rendu
  comme « < 5 » — un agrégat sur une seule PME est une donnée nominative.
- Aucune écriture, sous aucune forme : pas de POST, pas de PATCH, pas de
  webhook entrant. La clé FODIP ne porte qu'un droit : lire cette route.

### Ce qui n'est pas décidé, et pourquoi c'est volontaire

- Le barème (décision 5). Convention à signer.
- La périodicité du calcul (mensuelle est le défaut proposé ; le pilote peut
  demander hebdomadaire). Un paramètre du travail planifié, pas une décision
  d'architecture.

## Front — route de démonstration livrée

`/demo/ocr-relecture` (`apps/web/src/app/(app)/demo/ocr-relecture/`) montre au
fonds le parcours de relecture d'ADR-122 en trois écrans sur une page :

1. **Signalétique** — le composant réel `OcrReviewAlert`, avec son contrat
   réel (`findings: OcrFinding[]`, codes fermés). L'écart montré est
   `TOTAL_TTC` sur `totals.totalTTC` : le commerçant est en TPU (TVA nulle,
   HT = TTC), la somme des lignes doit retomber sur le pied écrit, et le modèle
   a lu « 0 » au pied. `attendu` = `22450000` (224 500,00 GNF, somme des
   lignes), `constate` = `0`.
2. **Correction** — saisie des prix unitaires illisibles et du pied. Chaque
   frappe est réduite aux chiffres seuls *avant* tout calcul ; l'écart est
   recalculé en BigInt à chaque rendu, jamais stocké. Il n'y a pas de bouton
   « résoudre » : l'alerte disparaît quand l'équation devient vraie, et
   seulement alors.
3. **Scellage** — bouton inerte tant qu'un écart subsiste ; simulé (aucun
   appel, aucune signature), et le dit à l'écran.

La route est habillée par la coquille `(app)` et donc derrière une session :
`/demo` est ajouté à `PROTECTED_PREFIXES` et au matcher du proxy (sinon
`requireSessionToken()` lève une erreur au lieu de renvoyer vers `/login`).
Aucune donnée d'organisation n'est lue. Tout est simulé, y compris le texte de
la commande et les lignes lues.

Signalétique conforme au Design System : ambre `amber-text` sur surface
blanche pour l'alerte (5,2:1, AA), aucun hex arbitraire en `className`,
aucun `text-navy-*` sous `navy-600`, tokens `green-text`/`green-bg` pour
l'état résolu.

## Hors périmètre

- Le rôle, le guard, la table d'agrégats, le travail planifié et la route
  `/v1/partners/fodip/pilot-metrics` : tranche suivante, sur ce cadrage.
- Tout écran de relecture *réel* branché sur un `ocr_document` en
  `DRAFT_PENDING_MANUAL_REVIEW` — ADR-122 ne le livre pas non plus.
- Un code d'écart « prix manquant » côté serveur : la double-garde ne connaît
  que quatre codes ; en ajouter un est une décision d'ADR-122, pas de celle-ci.
