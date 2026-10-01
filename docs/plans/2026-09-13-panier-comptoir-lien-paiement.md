# Plan : Panier multi-articles et choix « espèces / lien de paiement » sur la vente au comptoir (2026-09-13)

## Contexte

Le fondateur veut que le bloc « Vente au comptoir » (`VenteComptoirForm`,
ADR-106, `/dashboard`) devienne un vrai panier multi-articles, et offre
explicitement au marchand le choix entre encaisser en espèces ou envoyer un
lien de paiement au client — « un autre moyen de payer sans cash ».

Le mécanisme serveur existe déjà et n'a besoin d'AUCUNE modification :
`InvoicesService.issue()` (`apps/trust-api/src/invoices/invoices.service.ts`,
~L605-690) génère et envoie un lien de paiement en best-effort à chaque
émission dès que le client a un téléphone et que
`organization.paymentLinkAutoSend !== false` (vrai par défaut), et renvoie la
facture à jour (`paymentLinkUrl`/`paymentLinkExpiresAt` déjà peuplés si ça a
marché). Le contrôleur (`invoices.controller.ts`, ~L100) relaie ce résultat
tel quel sur `POST /invoices/:id/issue`.

Le seul problème est côté web :
`apps/web/src/app/(app)/dashboard/invoices/new/actions.ts`,
`createAndIssueInvoiceAction`, appelle `await issueInvoice(token, invoice.id)`
sans capturer le résultat, puis `redirect("/dashboard")` sans confirmation —
la donnée existe déjà à cet endroit précis, elle est juste jetée. Le type
`InvoiceDetail` (`apps/web/src/lib/trust-api.ts`, retour de `issueInvoice()`)
ne déclare pas non plus `paymentLinkUrl`/`paymentLinkExpiresAt`, alors que la
réponse HTTP réelle (l'enregistrement Prisma complet) les porte déjà — écart
de typage pur, aucun changement runtime.

Le dépôt contient déjà deux chantiers non commités, sans rapport : la barre
latérale desktop (`feat/sidebar-desktop-adr095` :
`(app)/layout.tsx`, `AppHeader.tsx`, `SidebarNavigation.tsx`, `icons.tsx`,
`PortalTabs.tsx`, suppression `NavDrawer.tsx`/`PrimaryNav.tsx`) et les
corrections post-audit + tunnel d'inscription (`cabinet/mandates/page.tsx`,
`cabinet/page.tsx`, `dashboard/page.tsx`, `invoices/new/page.tsx`, suppression
`espace-cabinet`/`espace-marchand`, `lib/etapes-inscription.ts`,
`components/auth/EtapeIndicateur.tsx`, pages `register`/`onboarding`/
`nouveau-cabinet`). Ce plan n'y touche pas, y compris `(app)/dashboard/page.tsx`
qui importe `VenteComptoirForm` mais dont le contenu propre est hors sujet ici.

## Contrainte de conception déjà posée dans le code

`VenteComptoirForm.tsx` porte en tête un commentaire explicite : ce bloc
RÉUTILISE la Server Action de l'émission complète, « jamais une seconde qui
ferait le même travail à côté ». `createAndIssueInvoiceAction` est partagée
avec `InvoiceForm.tsx` (écran d'émission complet). La bonne coupe : l'action
ne doit plus jamais appeler `redirect()` elle-même — elle retourne toujours un
état (succès ou erreur), et chaque composant appelant décide de la suite
(`InvoiceForm` redirige côté client comme aujourd'hui ; `VenteComptoirForm`
affiche une confirmation inline).

## Problème

1. Le retour de `issueInvoice()` (facture à jour, avec lien de paiement
   éventuel) est jeté après l'émission côté comptoir comme côté écran complet.
2. `VenteComptoirForm` ne gère qu'une seule ligne (quantité 1) — pas un panier.
3. Aucun choix de canal de règlement n'est proposé au comptoir : toute vente
   émet silencieusement une facture, sans que le marchand puisse dire
   explicitement « ce client va payer par lien, pas en espèces » — et sans
   confirmation de ce qui s'est réellement passé (SMS envoyé ou non, lien
   généré ou non).
4. `InvoiceDetail` (lib/trust-api.ts) ne déclare pas `paymentLinkUrl`/
   `paymentLinkExpiresAt` sur le retour de `issueInvoice()`, alors que la
   réponse réelle les porte (écart de typage).

## Solution retenue

- **`lib/trust-api.ts`** : compléter `InvoiceDetail` avec
  `paymentLinkUrl: string | null` et `paymentLinkExpiresAt: string | null` —
  documente ce que `POST /invoices/:id/issue` renvoie déjà réellement (l'objet
  Invoice complet), sans toucher à `apps/trust-api`.
- **`invoices/new/actions.ts`** :
  - `CreateInvoiceActionState` devient
    `{ error: string } | CreateInvoiceSuccess | null`, avec
    `CreateInvoiceSuccess = { invoiceId, totalTtc, paymentLinkUrl,
    paymentLinkExpiresAt, settlementMode, customerPhone }` — même famille que
    `InvoiceActionState` de `invoices/[id]/actions.ts`
    (`{ error } | { ok } | null`), étendue ici avec les données que l'écran de
    confirmation doit afficher.
  - Nouveau champ formulaire `settlementMode` (`"cash" | "payment_link"`,
    défaut `"cash"` si absent/valeur inconnue — aucun changement pour
    `InvoiceForm.tsx`, qui n'envoie pas ce champ).
  - Si `settlementMode === "payment_link"` et qu'aucun numéro n'a été saisi
    (`customerPhone` vide, testé AVANT toute normalisation ou appel réseau) :
    retour `{ error: "Un numéro est nécessaire pour envoyer un lien de
    paiement" }`. Mode `"cash"` (ou absent) : comportement actuel inchangé,
    téléphone facultatif.
  - Capture du retour de `issueInvoice()` dans une variable ; suppression du
    `redirect("/dashboard")` interne ; `revalidatePath("/dashboard")` +
    `revalidatePath("/dashboard/invoices")` (cohérent avec
    `invoices/[id]/actions.ts`).
  - Le numéro normalisé résolu (`msisdn`), quand la résolution passe par le
    champ téléphone de ce formulaire, est reporté dans l'état de succès
    (`customerPhone`) pour permettre un message honnête (« envoyé au X » vs
    « aucun numéro fourni ») — jamais déduit d'une fiche client déjà
    existante, qui n'est pas dans le périmètre de ce formulaire.
- **`invoices/new/InvoiceForm.tsx`** : changement minimal. Comme l'action ne
  redirige plus, un `useEffect` déclenche `useRouter().push("/dashboard")`
  quand `state` devient un succès (présence de `invoiceId`) — comportement
  observable identique à aujourd'hui. Rien d'autre ne change sur cet écran.
- **`VenteComptoirForm.tsx`** — refonte :
  - Panier : `useState<LigneVente[]>`, un formulaire d'ajout (Article, Qté,
    Montant unitaire) qui pousse dans la liste et se vide, une liste compacte
    avec retrait par ligne, un total courant `font-mono tabular-nums`.
    `linesJson` reconstruit depuis ce panier au submit (même format
    `{description, quantity, unitPriceGnf}[]` qu'aujourd'hui — l'action ne
    change pas ce contrat).
  - Choix de règlement : deux `<input type="radio" name="settlementMode">`
    dans des `<label>` avec `has-[:checked]:border-navy-950
    has-[:checked]:bg-navy-50` — même pattern déjà utilisé par
    `MobileMoneyForm.tsx` pour un choix binaire/court, pas de nouveau
    composant générique. `"payment_link"` rend le téléphone visuellement et
    HTML `required`, et change le libellé du bouton (« Encaisser » →
    « Envoyer le lien »).
  - Confirmation inline après succès (remplace le fait de ne rien afficher
    puis rediriger) : montant total (`formatGnf`), lien de paiement dans un
    bloc `<code>` — même traitement visuel que la section « Lien de
    paiement » de `invoices/[id]/page.tsx` (~L390-404), pas de nouveau
    pattern — avec une ligne honnête sur l'envoi (SMS au numéro si fourni,
    sinon « montrez ce lien à votre client » sans jamais affirmer un envoi
    qui n'a pas eu lieu) ; cas `settlementMode === "payment_link"` avec
    `paymentLinkUrl === null` : message honnête sur l'échec de génération +
    lien vers `/dashboard/invoices/{id}` où `RegenerateLinkForm` existe déjà
    (pas de second mécanisme de régénération) ; lien « Voir la facture
    complète » ; bouton « Nouvelle vente » qui réinitialise tout l'état local
    (panier, champs, mode espèces par défaut) sans rechargement de page.

## Alternatives écartées

- Un composant `<RadioPill>` générique réutilisable : écarté, un seul choix
  binaire de plus dans le dépôt n'en justifie pas l'extraction — le pattern
  `has-[:checked]` déjà écrit dans `MobileMoneyForm.tsx` suffit et reste
  cohérent avec ce qui existe.
- Ajouter un bouton « copier » (Clipboard API) sur le lien de paiement :
  écarté, hors périmètre explicite de la demande — l'écran détail facture
  n'en a pas non plus pour le même bloc, on ne divergerait pas sans raison.
- Déduire `customerPhone` d'une fiche client existante pour le message
  d'envoi : écarté, `VenteComptoirForm` n'a pas de sélecteur de client (seul
  le champ téléphone existe côté comptoir) — la donnée n'existe nulle part
  ailleurs à cet endroit précis.

## Fichiers et tâches

1. `apps/web/src/lib/trust-api.ts` — étendre `InvoiceDetail`
   (`paymentLinkUrl`, `paymentLinkExpiresAt`).
2. `apps/web/src/app/(app)/dashboard/invoices/new/actions.ts` — nouveau type
   d'état, validation `settlementMode`/téléphone, capture du retour de
   `issueInvoice`, suppression du `redirect`, `revalidatePath` complété.
3. `apps/web/src/app/(app)/dashboard/invoices/new/actions.spec.ts` — étendre
   les tests (RED d'abord sur les nouveaux cas).
4. `apps/web/src/app/(app)/dashboard/invoices/new/InvoiceForm.tsx` —
   `useEffect` + `useRouter().push`.
5. `apps/web/src/app/(app)/dashboard/VenteComptoirForm.tsx` — panier,
   sélecteur de règlement, confirmation inline.

## Tests avant code

- `actions.spec.ts` (existant, ne doit pas casser) :
  - normalisation du numéro avant résolution client ;
  - refus d'un numéro invalide sans appel réseau ;
  - une fiche client choisie l'emporte sur le champ téléphone ;
  - facture anonyme possible sans client ni numéro.
- Nouveaux cas à ajouter (RED d'abord) :
  - `settlementMode: "payment_link"` sans `customerPhone` → erreur explicite
    (« numéro… lien de paiement »), sans appeler `resolveCustomerByPhone` ni
    `createInvoice` ni `issueInvoice`.
  - `settlementMode: "payment_link"` avec un numéro valide → succès, l'état
    porte `paymentLinkUrl`/`paymentLinkExpiresAt`/`invoiceId`/`totalTtc`
    renvoyés par le mock de `issueInvoice`, `settlementMode: "payment_link"`
    et `customerPhone` au format canonique.
  - `settlementMode` absent (ou `"cash"`) sans téléphone → succès inchangé,
    comportement actuel préservé (téléphone facultatif), `customerPhone:
    null` dans l'état retourné.
- Pas de nouveau test de rendu pour `VenteComptoirForm`/`InvoiceForm` : aucun
  harnais `testing-library` dans ce dépôt, et ces composants n'ont pas de
  logique pure isolable au-delà de ce qui est déjà testé côté action (même
  arbitrage que documenté pour `EtapeIndicateur.spec.tsx`, seul cas récent où
  un composant a justifié `renderToStaticMarkup`).

## Critères de done

- `createAndIssueInvoiceAction` ne redirige plus jamais elle-même ; les deux
  composants appelants décident chacun de la suite.
- Le comportement observable de `InvoiceForm.tsx` (redirection vers
  `/dashboard` après succès) est identique à aujourd'hui.
- `VenteComptoirForm.tsx` gère un panier multi-lignes, propose le choix
  espèces/lien de paiement, et affiche une confirmation honnête (y compris
  les cas d'échec de génération de lien) sans jamais recharger la page.
- Aucun fichier de `apps/trust-api`, `apps/money-api`, `packages/db` modifié.
- `pnpm --filter web lint`, `pnpm --filter web typecheck`,
  `pnpm --filter web test`, `pnpm --filter web build` passent tous.
- Aucun commit — working tree laissé pour relecture.

## Risques et limites

- Le champ `settlementMode` n'existe dans aucun contrat trust-api : c'est un
  choix purement côté web qui ne fait que conditionner (a) une validation de
  formulaire et (b) le texte de confirmation — il n'est jamais envoyé à
  trust-api, qui décide déjà seul, par organisation, d'envoyer ou non un lien
  (`paymentLinkAutoSend`). Un marchand qui choisit « espèces » peut donc,
  dans de rares cas (organisation avec l'auto-envoi actif), recevoir quand
  même un `paymentLinkUrl` non nul en retour : l'écran de confirmation ne
  doit alors afficher le bloc lien que si `paymentLinkUrl` est non nul, pas
  seulement si `settlementMode === "payment_link"`.
- Les changements non commités de `feat/sidebar-desktop-adr095` et du plan du
  jour sur le tunnel d'inscription touchent des fichiers voisins
  (`(app)/dashboard/page.tsx` notamment) ; ce plan ne les modifie pas.
- `design-system.guardrails.spec.ts` scanne tout `src/` (dégradés, hex en
  dur, contraste, plancher `font-display`) : le panier et le sélecteur de
  règlement restent sur les tokens existants (`navy-*`, `or`, `good`/`bad`).
