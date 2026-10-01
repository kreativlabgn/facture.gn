# Plan : rendre le parcours "Devis" fonctionnel côté web

## Contexte facture.gn
- Module : Web (Next.js App Router) — écrans d'émission (`dashboard/invoices/new`),
  de détail (`dashboard/invoices/[id]`) et de liste (`dashboard/invoices`). Trust
  Context déjà complet côté `apps/trust-api` (`InvoicesService.createDraft()`,
  `.convertToInvoice()`, `.issue()`) — aucun changement de route ni de RBAC.
- Persona affecté : toute organisation émettrice qui veut proposer un prix avant
  engagement (devis) plutôt qu'une facture certifiée immédiate.
- Données sensibles manipulées : montants financiers déjà couverts par le
  parcours facture existant ; aucune PII nouvelle. `quoteValidUntil` est une
  simple date, non sensible.
- Impact réglementaire : ADR-064 (« un devis n'est jamais une facture certifiée,
  seule la conversion produit une facture »), déjà entièrement câblé côté
  `InvoicesService.issue()`/`.convertToInvoice()` — ce plan ne fait qu'exposer ce
  mécanisme existant côté web, jamais le rouvrir.

## Problème (en 3 lignes max)
`documentType=quote` est déjà accepté par `POST /invoices` et par
`POST /invoices/:id/convert-to-invoice`, mais aucun écran web ne peut aujourd'hui
créer un devis sans le faire échouer (l'action web appelle systématiquement
`issueInvoice()`, qui rejette tout `documentType ≠ invoice` en 409), ni le
convertir, ni le distinguer d'une facture dans la liste ou le détail.

## Solution retenue (en 5 lignes max)
Faire bifurquer `createAndIssueInvoiceAction` sur `documentType`: pour `quote`,
appeler `createInvoice()` seul (jamais `issueInvoice()`) et retourner un nouvel
état de succès distinct (`quoteId`, pas `invoiceId`) qui ne casse pas le
narrowing `"invoiceId" in state` déjà utilisé par `VenteComptoirForm.tsx`.
`InvoiceForm.tsx` redirige alors vers `/dashboard/invoices/{quoteId}` au lieu de
`/dashboard`, et affiche un champ optionnel "Valable jusqu'au" uniquement pour un
devis. Un nouveau couple `ConvertToInvoiceForm`/`convertToInvoiceAction` (calqué
sur `IssueInvoiceForm`) déclenche la route déjà fonctionnelle
`POST /invoices/:id/convert-to-invoice` et redirige vers la facture brouillon
créée — l'émission de cette nouvelle facture reste un geste séparé, via
`IssueInvoiceForm` déjà existant. Le filtre de liste et le badge "Devis"
réutilisent les primitives déjà en place (`Badge`, tone `blue`), sans nouveau
token couleur.

## Alternatives écartées
- **Ouvrir une route `PATCH /invoices/:id` pour `quoteValidUntil`** — écartée :
  `updateDraft()` whiteliste déjà le champ mais n'est câblée sur aucune route, et
  n'ouvrir une route PATCH complète pour un seul champ optionnel créerait une
  surface d'attaque (n'importe quel autre champ de `DraftInvoicePatch`) pour un
  gain minime. Étendre `createInvoiceSchema` avec `quoteValidUntil` optionnel à
  la création couvre 100 % du besoin produit (F) sans nouvelle route. Confirmé :
  c'est la voie retenue.
- **Dupliquer `createAndIssueInvoiceAction` en une seconde action
  `createQuoteAction` dédiée** — écartée : le calcul des lignes (GNF→centimes),
  la résolution client par téléphone (ADR-106) et la gestion `referenceMarche`
  seraient alors dupliqués entre deux actions pour un seul point de divergence
  réel (appeler ou non `issueInvoice()`). Une bifurcation interne à l'action
  existante, testée explicitement pour les deux branches, est plus sûre qu'une
  copie qui pourrait diverger silencieusement.
- **Badge "Devis" affiché aussi sur `dashboard/page.tsx` (accueil) et la vue
  cabinet** — écarté du périmètre explicite de ce plan (spec B : uniquement
  l'écran `/dashboard/invoices`). Le badge est ajouté dans les primitives
  partagées (`InvoiceList.tsx`, `StatusPill.tsx`) parce que le PM l'exige
  explicitement pour "la liste/détail" et que ces deux fichiers ne sont pas dans
  la liste des fichiers gelés — mais aucun de leurs appelants gelés
  (`dashboard/page.tsx`, vue cabinet) n'est modifié ni testé ici (voir Risques).
- **Filtrer `documentType` côté serveur (`GET /invoices?documentType=...`)** —
  hors scope (G, décision produit déjà actée) : la liste est déjà plafonnée à
  `take=100` sans pagination, un filtre client sur un tableau déjà en mémoire
  est strictement suffisant et n'ajoute aucun aller-retour réseau.
- **Afficher `quoteValidUntil` dans la ligne de liste `InvoiceList.tsx`** —
  écarté : la ligne de liste est déjà dense sur mobile (numéro, date, montant,
  statut, pastilles de cycle légal) ; la date de validité n'a de valeur qu'au
  moment de décider d'une conversion, donc seulement sur l'écran de détail.

## Découpage en tâches bite-sized (2–5 min chacune)

### Backend (`apps/trust-api`) — un seul champ à faire traverser
- [ ] Tâche B1 : `apps/trust-api/src/invoices/dto/create-invoice.dto.ts` —
      ajouter `quoteValidUntil: z.coerce.date().optional()` dans
      `createInvoiceSchema` (bloc `cadreFacturation`/`numeroBonCommande`, même
      style que les champs B2G), sans refine croisé avec `documentType` (même
      discipline que `referenceMarche` : champ déclaratif, jamais vérifié).
- [ ] Tâche B2 : `apps/trust-api/src/invoices/invoices.service.ts` —
      `createDraft()` (~L198-253), ajouter `quoteValidUntil: dto.quoteValidUntil,`
      dans l'objet `data` passé à `scoped.invoice.create()`, juste après
      `referenceMarche` (même position que dans `DraftInvoicePatch`).

### Web — `lib/trust-api.ts` (typage + nouvelle fonction cliente)
- [ ] Tâche W1 : ajouter `documentType: string;` à `InvoiceListItem`
      (~L207-224), avec un commentaire sur le même modèle que
      `disputeStatus`/`validatedByAdministration` juste au-dessus (le champ
      traverse déjà l'API, seul le typage manquait).
- [ ] Tâche W2 : ajouter `quoteValidUntil?: string;` à `CreateInvoiceInput`
      (~L425-434), juste après `referenceMarche`, même commentaire de convention
      (déclaratif, optionnel).
- [ ] Tâche W3 : ajouter `quoteValidUntil: string | null;` à `InvoiceFullDetail`
      (~L518-563), positionné près de `referenceMarche`/`issuedAt`.
- [ ] Tâche W4 : ajouter la fonction cliente `convertToInvoice()` juste après
      `issueInvoice()` (~L475), sur le modèle exact de `voidInvoice()` (POST sans
      body, relaie `body?.message` tel quel) :
      `POST /invoices/${id}/convert-to-invoice`, retourne `InvoiceDetail`.

### Web — écran d'émission (`dashboard/invoices/new`)
- [ ] Tâche F1 : `InvoiceForm.tsx` — remplacer le `<select>` non contrôlé
      `documentType` (defaultValue) par un état contrôlé
      `useState<"invoice" | "quote">("invoice")`.
- [ ] Tâche F2 : `InvoiceForm.tsx` — ajouter le champ `<input type="date"
      name="quoteValidUntil">` "Valable jusqu'au — optionnel", affiché
      uniquement quand `documentType === "quote"` (juste après le bloc
      `documentType`, avant `referenceMarche`).
- [ ] Tâche F3 : `InvoiceForm.tsx` — libellé du bouton et texte d'aide
      conditionnels à `documentType` ("Créer le devis" / "Émettre et certifier",
      et la phrase d'aide sous le bouton, cf. Solution retenue).
- [ ] Tâche F4 : `InvoiceForm.tsx` — le `useEffect` (L28-32) distingue
      `"invoiceId" in state` (redirection `/dashboard`, inchangé) de `"quoteId"
      in state` (nouvelle branche : redirection
      `/dashboard/invoices/${state.quoteId}`).
- [ ] Tâche F5 : `actions.ts` — ajouter le type `CreateQuoteDraftSuccess =
      { documentType: "quote"; quoteId: string }` (nommage `quoteId`, jamais
      `invoiceId`, pour ne jamais faire matcher le narrowing `"invoiceId" in
      state` de `VenteComptoirForm.tsx`) et étendre
      `CreateInvoiceActionState` en `{ error: string } | CreateInvoiceSuccess |
      CreateQuoteDraftSuccess | null`.
- [ ] Tâche F6 : `actions.ts` — après la lecture de `documentType` (L60) et
      juste avant l'appel réseau final (L136-151), bifurquer : si
      `documentType === "quote"`, lire `quoteValidUntil` du FormData (format
      `"YYYY-MM-DD"`, `undefined` si vide — même discipline que
      `referenceMarche`), appeler `createInvoice()` seul avec ce champ,
      `revalidatePath("/dashboard/invoices")`, et retourner
      `{ documentType: "quote", quoteId: draft.id }` — jamais
      `issueInvoice()`. Le reste (branche facture existante) est strictement
      inchangé.

### Web — écran de détail (`dashboard/invoices/[id]`)
- [ ] Tâche D1 : `StatusPill.tsx` — ajouter `DocumentTypeBadge({ documentType
      })`, `null` si `documentType !== "quote"`, sinon `<Badge
      tone="blue">Devis</Badge>` (tone déjà validé par le PM, aucun nouveau
      token).
- [ ] Tâche D2 : `invoices/[id]/page.tsx` — insérer
      `<DocumentTypeBadge documentType={invoice.documentType} />` dans l'en-tête
      (L121-127), juste après `<StatusPill .../>`, avant `<DisputeStatusPill
      .../>` ; importer `DocumentTypeBadge` depuis `@/components/StatusPill`.
- [ ] Tâche D3 : `invoices/[id]/page.tsx` — corriger `peutEmettre` (L77) en
      `brouillon && invoice.documentType === "invoice" &&
      hasPermission(role, "invoices:issue")` — un devis/proforma brouillon ne
      doit plus jamais afficher `IssueInvoiceForm` (aujourd'hui voué à un 409).
- [ ] Tâche D4 : `invoices/[id]/page.tsx` — ajouter
      `peutConvertir = brouillon && (invoice.documentType === "proforma" ||
      invoice.documentType === "quote") && hasPermission(role,
      "invoices:convert")`, juste après `peutEmettre`.
- [ ] Tâche D5 : `invoices/[id]/page.tsx` — dans le bloc "Actions" (L409-452),
      ajouter le rendu conditionnel de `ConvertToInvoiceForm` quand
      `peutConvertir` (nouveau `<Card>`, même position que `IssueInvoiceForm`),
      et étendre la condition d'affichage de la section
      (`peutEmettre || peutConvertir || peutAnnuler || peutRelancer || emise`).
- [ ] Tâche D6 : `invoices/[id]/page.tsx` — rendre le titre/description du
      bloc `ProchaineAction` sur `brouillon` (L170-181) conditionnels à
      `invoice.documentType` : "Devis prêt à être converti" /
      "Vérifiez les lignes puis convertissez ce devis en facture pour pouvoir
      l'émettre." quand `documentType !== "invoice"`, texte actuel inchangé
      sinon — un devis brouillon ne doit jamais afficher un texte qui parle
      d'émission/certification directe (positionnement produit, CLAUDE.md).
- [ ] Tâche D7 : `invoices/[id]/page.tsx` — afficher `invoice.quoteValidUntil`
      (formaté par `formatDate`) dans le bloc "Montants" (`<dl>` L208-222),
      juste après `referenceMarche`, uniquement si non nul.
- [ ] Tâche D8 : `invoices/[id]/InvoiceActions.tsx` — ajouter l'import
      `useEffect`/`useRouter` et le composant `ConvertToInvoiceForm`, calqué
      exactement sur `IssueInvoiceForm` (case à cocher de confirmation, bouton
      "Convertir en facture") mais avec un `useEffect` qui redirige vers
      `/dashboard/invoices/${state.newInvoiceId}` dès que l'état porte
      `newInvoiceId` (jamais un `redirect()` serveur — même précédent que
      `InvoiceForm.tsx`, la Server Action reste pure et c'est le composant
      client qui navigue).
- [ ] Tâche D9 : `invoices/[id]/actions.ts` — ajouter le type
      `ConvertToInvoiceActionState = { error: string } | { newInvoiceId: string
      } | null` et l'action `convertToInvoiceAction()`, calquée sur le corps de
      `executer()` mais SANS passer par ce helper (qui ne retourne qu'un `{ ok
      }` statique) : appelle `convertToInvoice(token, invoiceId)`, revalide les
      trois mêmes chemins que `executer()`
      (`/dashboard/invoices/${invoiceId}`, `/dashboard/invoices`,
      `/dashboard`), retourne `{ newInvoiceId: converted.id }`.

### Web — liste (`dashboard/invoices`)
- [ ] Tâche L1 : `InvoiceList.tsx` — insérer
      `<DocumentTypeBadge documentType={invoice.documentType} />` juste après
      `<StatusPill status={invoice.status} />` (L51), import depuis
      `@/components/StatusPill`.
- [ ] Tâche L2 : nouveau fichier
      `apps/web/src/app/(app)/dashboard/invoices/InvoiceTypeFilter.tsx` — client
      component qui enveloppe `InvoiceList` SANS le modifier davantage : état
      local `"all" | "invoice" | "quote"`, trois boutons segmentés (style
      inspiré des radios "Espèces/Lien de paiement" de `VenteComptoirForm.tsx` —
      référence de style uniquement, ce fichier n'est ni importé ni modifié),
      filtre `invoices` par `documentType` avant de les passer à `InvoiceList`.
- [ ] Tâche L3 : `invoices/page.tsx` — remplacer l'import/usage de
      `InvoiceList` par `InvoiceTypeFilter`, mêmes props (`invoices`,
      `emptyMessage`, `href`).

## Tests à écrire AVANT le code

### Backend
- [ ] Test B1 (`create-invoice.dto.spec.ts`, nouveau `describe` "date de
      validité du devis (F, quoteValidUntil)") : accepte `quoteValidUntil` au
      format date et le parse en `Date` — même style que le describe
      "référence marché" déjà présent.
- [ ] Test B2 (même fichier) : accepte une création sans `quoteValidUntil` —
      non-régression explicite (`result.data.quoteValidUntil` est `undefined`).
- [ ] Test B3 (`invoices.service.spec.ts`, nouveau `describe`
      "InvoicesService — date de validité du devis (F, quoteValidUntil)",
      placé après le describe "référence marché" existant ~L358) : `createDraft()`
      persiste `quoteValidUntil` tel quel quand fourni sur un `documentType:
      "quote"`.
- [ ] Test B4 (même fichier) : sans `quoteValidUntil`, le comportement reste
      strictement inchangé (`quoteValidUntil` reste `null` en sortie) — même
      gabarit que le test de non-régression `referenceMarche` (~L358).

### Web — action de création
- [ ] Test W1 (`invoices/new/actions.spec.ts`, nouveau describe
      "createAndIssueInvoiceAction — devis (documentType=quote)") : avec
      `documentType: "quote"`, l'action appelle `createInvoiceMock` mais
      JAMAIS `issueInvoiceMock`.
- [ ] Test W2 (même describe) : l'état de succès retourné porte `{
      documentType: "quote", quoteId: <id du brouillon créé> }` — pas de champ
      `invoiceId` (garantit le narrowing intact pour `VenteComptoirForm.tsx`).
- [ ] Test W3 (même describe) : `quoteValidUntil` du formulaire (`"2026-12-31"`)
      est transmis tel quel à `createInvoiceMock` dans le payload.
- [ ] Test W4 (même describe) : sans `quoteValidUntil` dans le formulaire, le
      payload envoyé à `createInvoiceMock` ne porte pas la clé (ou porte
      `undefined`) — non-régression du chemin facture, qui ne doit jamais
      recevoir ce champ implicitement.
- [ ] Test W5 (même describe, ou describe existant "état de succès et choix du
      règlement") : avec `documentType: "invoice"` (défaut), le comportement
      actuel est strictement inchangé — `createInvoiceMock` PUIS
      `issueInvoiceMock` sont appelés, l'état retourné porte toujours
      `invoiceId` — non-régression explicite protégeant `VenteComptoirForm.tsx`.

### Web — écran de détail
- [ ] Test D1 (nouveau `invoices/[id]/actions.spec.ts` si absent, sinon
      fichier existant) : `convertToInvoiceAction()` sans `invoiceId` retourne
      `{ error: "Action impossible : identifiant de facture manquant" }` sans
      appeler `convertToInvoice`.
- [ ] Test D2 (même fichier) : `convertToInvoiceAction()` relaie le message de
      `TrustApiError` tel quel sur échec (ex. 409 "déjà converti").
- [ ] Test D3 (même fichier) : `convertToInvoiceAction()` retourne `{
      newInvoiceId: <id> }` sur succès et revalide les trois mêmes chemins que
      les autres actions de ce fichier.
- [ ] Test D4 (composant `ConvertToInvoiceForm`, test de rendu/interaction si
      la convention du dépôt teste les composants clients de ce dossier —
      sinon couverture par D3 côté action suffit, à confirmer avec
      frontend-developer) : le bouton reste désactivé tant que la case de
      confirmation n'est pas cochée.

## Critères de done
- Tous les tests neufs et existants verts (`pnpm --filter trust-api test`,
  `pnpm --filter web test`).
- `pnpm --filter trust-api lint typecheck test build` vert.
- `pnpm --filter web lint typecheck test build` vert — en particulier
  `design-system.guardrails.spec.ts` (aucun hex en dur, badge `Devis` sur tone
  `blue` déjà existant) et `apps/web/src/app/(app)/dashboard/VenteComptoirForm.tsx`
  continue de typechecker SANS aucune modification de son propre fichier
  (`CreateInvoiceSuccess`/`CreateInvoiceActionState` restent structurellement
  compatibles).
- Vérification manuelle E2E : créer un devis (bouton "Créer le devis",
  redirection vers `/dashboard/invoices/{id}`) → le devis n'affiche ni preuve
  de certification ni `IssueInvoiceForm` → "Convertir en facture" crée une
  nouvelle facture `draft` et redirige dessus → `IssueInvoiceForm` (déjà
  existant) émet cette nouvelle facture normalement → le devis d'origine
  apparaît `Convertie` dans la liste, filtrable via "Devis".
- Aucun vocabulaire d'autorité publique/sceau officiel introduit (CLAUDE.md).
- `dev-code-reviewer` OK.
- `dev-domain-model-reviewer` non nécessaire : aucun nouvel invariant de
  domaine, le mécanisme métier (ADR-064) est déjà entièrement testé côté
  `apps/trust-api` par les plans C15/C16 précédents.

## Risques identifiés & mitigations
- **Risque** : casser silencieusement le narrowing `"invoiceId" in state` que
  `VenteComptoirForm.tsx` utilise pour discriminer succès/erreur, alors que ce
  fichier est explicitement interdit de modification. **Mitigation** : le cas
  devis introduit un champ `quoteId` distinct, jamais `invoiceId` — testé
  explicitement (Test W2, W5) et vérifié par le typecheck de
  `VenteComptoirForm.tsx` lui-même dans le critère de done (il compile sans
  édition).
- **Risque** : `InvoiceList.tsx` et `StatusPill.tsx` sont partagés avec
  `dashboard/page.tsx` (accueil) et la vue cabinet
  (`listOrganizationInvoicesForCabinet`), deux surfaces gelées par consigne
  explicite. Le badge "Devis" y apparaîtra donc aussi, sans que ces écrans
  aient été testés ou relus dans ce plan. **Mitigation** : le changement est
  strictement additif (nouveau composant qui retourne `null` pour tout
  `documentType !== "quote"`, comportement inchangé sur toute facture
  existante) et n'exige aucune modification des fichiers gelés eux-mêmes —
  mais backend-developer/frontend-developer doivent vérifier visuellement
  l'accueil et la vue cabinet après merge (pas seulement l'écran
  `/dashboard/invoices`) avant de considérer la tâche close.
- **Risque** : `quoteValidUntil` envoyé par un `<input type="date">` HTML
  produit une chaîne `"YYYY-MM-DD"` sans fuseau horaire — `z.coerce.date()`
  l'interprète en UTC minuit, ce qui peut afficher "la veille" selon le fuseau
  de lecture. **Mitigation** : hors scope de correction ici (même comportement
  que `fxRateDate`, déjà accepté tel quel ailleurs dans le DTO) — à documenter
  dans le commentaire du champ côté DTO plutôt qu'à corriger, pour ne pas
  introduire une logique de fuseau horaire non demandée par le PM.
- **Risque** : un appelant direct de l'API (hors web) pourrait envoyer
  `documentType: "proforma"` au formulaire web (impossible aujourd'hui, le
  `<select>` n'offre que "Facture"/"Devis" — E, hors scope) puis tomber sur la
  branche facture de l'action, qui appellerait `issueInvoice()` et recevrait un
  409 relayé tel quel. **Mitigation** : comportement strictement inchangé par
  rapport à l'existant (déjà le cas avant ce plan) — non traité, explicitement
  hors scope (E).
- **Risque** : `peutEmettre` devient plus strict (ajout de `documentType ===
  "invoice"`) — si un appelant avait ADAPTÉ son usage au bug actuel (bouton
  d'émission visible sur un devis), ce changement le fait disparaître.
  **Mitigation** : c'est le comportement CORRECT recherché par ce plan (un
  devis ne doit jamais afficher un bouton voué à un 409) — à couvrir par un
  test si le dépôt a un test de rendu pour cette page (à vérifier avec
  frontend-developer ; sinon la garde reste couverte indirectement par le fait
  que `issue()` refuse déjà ce cas côté service, testé en B).
