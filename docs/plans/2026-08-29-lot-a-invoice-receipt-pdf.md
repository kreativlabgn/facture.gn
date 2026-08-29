# Plan : Lot A — Restitution PDF (facture certifiée + reçu de paiement)

## Contexte projet
- Module : **Trust Context** (`apps/trust-api`). Nouveau module `src/rendering/` calqué sur `fec/` et `verification/`. Modifie `invoices.controller.ts`, `payments.controller.ts`, `app.module.ts`. **Aucune migration `packages/db`** — lecture seule, aucun champ ajouté.
- Persona affecté : PME (10 personas), et indirectement client `client_portal` / DAF B2G (accès à leur PDF = fast-follow hors de ce lot, voir §Alternatives).
- Données sensibles manipulées : montants GNF, NIF organisation, nom/téléphone client, `certificationId`. Aucun PIN, secret, clé. → `dev-security-reviewer` requis (nouveau canal de lecture = risque IDOR / fuite cross-organisation).
- Impact réglementaire : OHADA/SYSCOHADA — mentions obligatoires sur la facture (Art. 23 séquence, identification des parties, ventilation HT/TVA/TTC, régime fiscal). ADR-019 (PDF/A-3 + XML embarqué) **explicitement différé** à un lot ultérieur.

## Spec consultée
- `V/Registre-ADR-facture-gn.md` : ADR-019 (PDF/A-3 pour archivage long terme — embarque XML + signature), ADR-017 (Ed25519), ADR-023 (`certification_id` seul identifiant public, jamais l'UUID interne).
- `V/DAT-facture-gn.md` §Stockage (MinIO WORM 10 ans pour PDF/A — **non scaffoldé** dans le repo).
- `apps/trust-api/src/verification/verification.service.ts` — `PublicInvoiceVerification` expose déjà tout le nécessaire pour le pied de page (`certificationId`, `integrityValid`, `keyValidAtIssuance`, `number`, `totalTtc`, `issuedAt`, `organizationNif`).
- Pas de gabarit / maquette PDF dans `V/` — greenfield au sein du projet.

## Clarifications (brainstorm 2026-08-29)
- Q: Lib PDF (contrainte : pas de Chromium) ? → R: **pdfmake** (déclaratif, pur JS, polices Roboto embarquées → accents FR, tableaux natifs).
- Q: Reçu de paiement — périmètre ? → R: **un seul `renderReceipt()` couvrant tous les modes** (cash, `bank_transfer`, `payment_link`/Mobile Money, arrhes `depositType`).
- Q: Accès client-portal (F13) / DAF (J1/J2) dans ce lot ? → R: **non** — org uniquement ce lot (`GET /invoices/:id/pdf` pour les rôles internes). Les identités non-`OrganizationMember` (autorisation inline, pas `RolesGuard`) = fast-follow séparé.
- Q: Stockage ? → R: **à la volée, aucun stockage** — le PDF est déterministe (facture immuable après `issue()`). Archivage MinIO/PDF-A = lot dédié avec ADR-019.
- Q (défaut retenu, non posé) : proforma/devis imprimables ? → R: **non ce lot** — `documentType = "invoice"` + `certificationId` non nul requis. Une facture `voided` reste imprimable avec filigrane « ANNULÉE » (elle garde numéro + certification).
- Q (défaut retenu) : version SMS/texte du reçu ? → R: **hors scope ce lot** (l'option USSD 2 « Vérifier un reçu » existe déjà et est indépendante).
- Q (défaut retenu) : horodatage de génération sur le PDF ? → R: **aucun** — le contenu ne dépend que des champs de la facture (déterminisme testable) ; le pied de page renvoie à `verify.facture.gn/{certificationId}` sans timestamp volatil.

## Problème (3 lignes max)
facture.gn ne produit aujourd'hui **aucun document opposable** : seulement du JSON. Une PME ne peut pas remettre une facture imprimée, un client ne peut pas archiver de justificatif, un fournisseur de marché public n'a pas de pièce pour son dossier. La plateforme n'est pas utilisable en conditions réelles sans cette couche de restitution.

## Solution retenue (5 lignes max)
Nouveau module `apps/trust-api/src/rendering/` : un **renderer pur** (`document-renderer.ts`, zéro I/O — construit un `docDefinition` pdfmake) + des helpers purs (`money-format.ts`, `legal-mentions.ts` keyé par `RegimeFiscal`) + un **service d'orchestration** (`rendering.service.ts` — charge la facture/le paiement via Prisma, vérifie la cohérence, appelle le renderer, renvoie un `Buffer`). Deux routes GET renvoyant un `application/pdf` via `StreamableFile` : `GET /invoices/:id/pdf` (rôles = ceux de `GET /invoices/:id`) et `GET /invoices/:id/payments/:paymentId/receipt` (rôles = ceux de `POST .../payments`). Le QR code (lib `qrcode`) encode l'URL de vérification publique. Génération à la volée, aucun stockage.

## Alternatives écartées
1. **Rendu HTML → PDF via Chromium/puppeteer** — écarté : image k8s lourde, surface CVE, incompatible cible « k8s légère ».
2. **`@react-pdf/renderer`** — écarté : tire React dans `trust-api` (aujourd'hui 0 React côté API), runtime plus lourd, pour un gain d'ergonomie marginal sur un seul gabarit.
3. **PDF/A-3 conforme + XML EN 16931 embarqué dès ce lot (ADR-019)** — écarté : conformité PDF/A stricte (profil ICC, XMP, polices 100 % embarquées, `OutputIntent`) + génération du XML structuré = chantier à part entière. Le renderer est structuré pour l'accueillir (fonction `buildStructuredData()` isolée), pas construit ici.
4. **Stockage MinIO à l'émission** — écarté : MinIO non scaffoldé, et un artefact déterministe n'a pas besoin d'être stocké pour être re-servi. Introduit un couplage stockage dans le chemin critique `issue()` sans bénéfice immédiat.
5. **Routes PDF pour `client_portal` / portail DAF dans ce lot** — écarté du périmètre : ces identités ne sont pas des `OrganizationMember`, leur autorisation est **inline dans le service** (jamais `RolesGuard`/`@OrganizationIdSource`) — c'est un chemin d'autorisation distinct qui mérite sa propre revue sécurité. Fast-follow : `GET /client-portal/invoices/:id/pdf` (résolu par téléphone vérifié) et `GET /public-buyer/invoices/:id/pdf` (résolu par `PublicBuyerAccountMember`).

## Découpage en tâches bite-sized

### Groupe 1 — Helpers purs (aucune dépendance externe, parallélisables)
- [ ] [P] Tâche 1 : `src/rendering/money-format.ts` — `formatGnf(centimes: bigint): string` → `"1 250 000 GNF"` (séparateur d'espace insécable, division par 100, jamais de décimale — GNF sans subdivision en pratique). Export `formatGnfAmount` réutilisable.
- [ ] [P] Tâche 2 : `src/rendering/legal-mentions.ts` — `legalMentionsFor(regime: RegimeFiscal): string[]` : `normal_tva` → mention pénalités de retard + indemnité forfaitaire ; `tpu` → « TPU — impôt forfaitaire, TVA non facturée » ; `normal_sans_tva` / `non_assujetti_association` → « TVA non applicable ». Aucune invention de taux (réutilise la logique de `tax-regime.ts`).
- [ ] [P] Tâche 3 : `src/rendering/verification-qr.ts` — `buildVerificationQrDataUrl(certificationId: string): Promise<string>` via `qrcode` (PNG data URL, niveau de correction M). URL = `${PUBLIC_VERIFICATION_BASE_URL}/${certificationId}` (nouvelle variable d'env, défaut `https://verify.facture.gn`).

### Groupe 2 — Renderer pur
- [ ] Tâche 4 : `src/rendering/document-renderer.ts` — `buildInvoiceDocDefinition(input: InvoiceRenderInput): TDocumentDefinitions`. `InvoiceRenderInput` = type explicite (organisation : nom/NIF/RCCM/adresse ; client optionnel ; lignes ; totaux ; `number` ; `issuedAt` ; `certificationId` ; `status` ; `discountPct` ; `qrDataUrl` ; `legalMentions`). En-tête émetteur, bloc client, tableau des lignes (désignation / qté / PU HT / total HT), récap HT + TVA + TTC, remise si `discountPct > 0`, filigrane « ANNULÉE » si `status === "voided"`, pied de page : `certificationId` + QR + « Facture certifiée — vérifiable sur … ». **Aucun `new Date()`, aucun accès DB, aucun `fs` hors chargement des polices.**
- [ ] Tâche 5 : `src/rendering/document-renderer.ts` — `buildReceiptDocDefinition(input: ReceiptRenderInput): TDocumentDefinitions`. `ReceiptRenderInput` = { facture : `number` / `certificationId` ; paiement : `method` / `depositType` / `amount` / `amountCollected` / `platformFeeAmount` / `gatewayFeeAmount` / `providerRef` / `providerSubMethod` / `collectedAt` ; solde facture après paiement : `amountPaid` / `amountDue` }. Libellé du mode : `cash` → « Espèces », `bank_transfer` → « Virement bancaire », `payment_link` → « Mobile Money (…providerSubMethod) », `depositType="arrhes"` → « Arrhes (dépôt de sécurité) » avec mention explicite « non imputé au solde de la facture » (cf. commentaire schéma `Payment.amount`). Affiche `providerRef` comme référence de transaction quand présent.
- [ ] Tâche 6 : `src/rendering/pdf-printer.ts` — wrapper `renderToBuffer(docDefinition): Promise<Buffer>` via `PdfPrinter` de pdfmake + polices Roboto (vendorées dans `src/rendering/fonts/` ou résolues depuis le paquet). Isole le seul point d'I/O (polices) et la seule dépendance stateful.

### Groupe 3 — Service d'orchestration
- [ ] Tâche 7 : `src/rendering/rendering.service.ts` — `renderInvoicePdf(invoiceId: string): Promise<Buffer>` : `findUniqueOrThrow` (include `organization`, `customer`, `lines`) → si `documentType !== "invoice"` ou `!certificationId` → `ConflictException("Aucun PDF disponible : la facture n'est pas encore émise")` → assemble `InvoiceRenderInput` (via helpers) → `buildInvoiceDocDefinition` → `renderToBuffer`.
- [ ] Tâche 8 : `src/rendering/rendering.service.ts` — `renderReceiptPdf(invoiceId: string, paymentId: string): Promise<Buffer>` : charge la facture + le paiement, **vérifie `payment.invoiceId === invoiceId`** (IDOR — sinon `NotFoundException`), `payment.status !== "completed"` → `ConflictException`, assemble `ReceiptRenderInput`, rend.
- [ ] Tâche 9 : `src/rendering/rendering.module.ts` — `@Module` (imports `PrismaModule`, providers `RenderingService`), et `app.module.ts` l'importe.

### Groupe 4 — Exposition HTTP
- [ ] Tâche 10 : `invoices.controller.ts` — `@Get(":id/pdf")` `@Roles("owner","admin","accountant_internal","cashier","field_agent","tax_controller_readonly","viewer")` → `StreamableFile` avec `Content-Type: application/pdf` et `Content-Disposition: attachment; filename="facture-<number>.pdf"`. idSource `"invoice"` par défaut (déjà le cas pour `findOne`).
- [ ] Tâche 11 : `payments.controller.ts` — `@Get(":paymentId/receipt")` (route complète `invoices/:id/payments/:paymentId/receipt`) `@Roles("owner","admin","cashier","field_agent","delivery_driver","accountant_internal")` → `StreamableFile`, `filename="recu-<number>-<paymentId>.pdf"`. `:id` (facture) alimente `RolesGuard` comme pour les POST existants du même contrôleur.
- [ ] Tâche 12 : `apps/trust-api` `package.json` — ajouter `pdfmake` + `qrcode` (+ `@types/pdfmake`, `@types/qrcode` en dev). Vérifier `pnpm-workspace.yaml` `allowBuilds` si besoin. `pnpm audit` sur les nouvelles deps (contrôle CVE, cf. overrides existants).

### Groupe 5 — Câblage optionnel (best-effort, non bloquant)
- [ ] Tâche 13 : `apps/web` — bouton « Télécharger la facture (PDF) » sur `dashboard/invoices/[id]` (lien direct vers l'endpoint, `<a download>`), affiché seulement si `status !== "draft"`. Déclenche `dev-frontend-quality`.

## Tests à écrire AVANT le code
- [ ] `money-format.spec.ts` : `0n → "0 GNF"` ; `125000n → "1 250 GNF"` ; `100n → "1 GNF"` ; `123456789n → "1 234 567 GNF"` ; jamais de décimale ; `bigint` négatif → à définir (attendu : jamais appelé avec du négatif, mais test de garde).
- [ ] `legal-mentions.spec.ts` : chaque valeur de `RegimeFiscal` produit un tableau non vide et cohérent ; `non_assujetti_association` et `normal_sans_tva` contiennent « TVA non applicable » ; `normal_tva` contient une mention de pénalités de retard ; aucune mention n'invente un taux.
- [ ] `verification-qr.spec.ts` : renvoie un data URL `data:image/png;base64,…` ; encode bien `<base>/<certificationId>` (décoder le QR dans le test) ; `PUBLIC_VERIFICATION_BASE_URL` respecté si défini.
- [ ] `document-renderer.spec.ts` (facture) : `docDefinition` **déterministe** — deux appels avec le même input produisent un objet identique (aucun `Date.now`) ; contient `number`, `certificationId`, tous les libellés de lignes, le total TTC formaté ; filigrane « ANNULÉE » présent ssi `status === "voided"` ; bloc client absent si `customer` absent ; ligne remise présente ssi `discountPct > 0`.
- [ ] `document-renderer.spec.ts` (reçu) : libellé correct par `method` ; arrhes → mention « non imputé au solde » ; `providerRef` rendu quand présent ; montants HT/collecté/frais cohérents avec l'input.
- [ ] `pdf-printer.spec.ts` : `renderToBuffer` d'un `docDefinition` minimal renvoie un `Buffer` commençant par `%PDF-` et non vide ; caractères accentués (« é à ç ») présents dans le texte extrait (garde polices).
- [ ] `rendering.service.spec.ts` : `renderInvoicePdf` sur une facture `draft` → `ConflictException` ; sur `documentType: "proforma"` → `ConflictException` ; sur une facture émise → `Buffer` `%PDF-` ; `renderReceiptPdf` avec `paymentId` d'une **autre** facture → `NotFoundException` (test IDOR) ; paiement `pending` → `ConflictException`.
- [ ] `invoices.controller.spec.ts` / `payments.controller.spec.ts` : header `Content-Type: application/pdf` + `Content-Disposition` ; un rôle hors liste (`delivery_driver` sur `/pdf`, `viewer` sur `/receipt`) → 403 ; `viewer`/`tax_controller_readonly` peuvent lire `/pdf` ; IDOR cross-organisation → 403/404 (via `RolesGuard`, test aligné sur les specs existantes du repo).

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts (`vitest run` trust-api ; seul échec toléré = `invoice-numbering.service.integration.spec.ts`, pré-existant)
- `pnpm --filter @facture-gn/trust-api typecheck` + `lint` clean
- Aucune donnée sensible loggée (le renderer ne logge rien ; le service ne logge pas les montants/NIF)
- Aucun secret hardcodé (`PUBLIC_VERIFICATION_BASE_URL` en env, défaut public non secret)
- `dev-code-reviewer` OK
- `dev-security-reviewer` OK (IDOR sur les 2 routes, contrôle d'accès `viewer`/`tax_controller_readonly`, absence de fuite du placeholder NIF interne — réutiliser la discipline de `verification.service.ts`)
- `dev-domain-model-reviewer` : pas de nouveau type de domaine persisté, mais valider que `InvoiceRenderInput`/`ReceiptRenderInput` rendent les états illégaux irreprésentables (pas de PDF possible sans `certificationId`)
- `dev-frontend-quality` OK (si Tâche 13 incluse)

## Risques identifiés & mitigations
- **R1 — IDOR sur `GET .../payments/:paymentId/receipt`** : `RolesGuard` valide l'organisation via `:id` (facture) mais pas que `:paymentId` appartient à cette facture → mitigation : vérification explicite `payment.invoiceId === invoiceId` dans le service, testée.
- **R2 — Réponse binaire casse la sérialisation / le `ZodValidationPipe` global** : mitigation : `StreamableFile` natif NestJS + pas de `@UsePipes` sur ces routes GET (aucun body) ; test de bout en bout du `Content-Type`.
- **R3 — pdfmake / polices : image k8s alourdie ou rendu accents cassé** : mitigation : polices Roboto vendorées et versionnées dans le repo (`src/rendering/fonts/`), pas de téléchargement runtime ; test d'extraction de texte accentué ; `pnpm audit` sur `pdfmake`+`qrcode` avant merge.
- **R4 — Fuite du placeholder NIF interne** (`UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER`) sur le PDF d'une organisation sans NIF : mitigation : le renderer affiche « NIF : en cours de vérification » quand `organization.nif` est `null`, jamais le placeholder — même discipline que `verification.service.ts`.
- **R5 — Non-déterminisme du PDF** (timestamp, ordre de Map) : mitigation : interdiction de `Date.now`/`new Date()` dans `document-renderer.ts` (test de double-rendu identique) ; itération sur des tableaux ordonnés, jamais des `Object.keys` non triés.
- **R6 — Perf : régénération sous charge** (DAT cible 1M factures/mois) : accepté ce lot (pas de cache) — la génération pdfmake d'une facture typique est < 100 ms, l'endpoint est un GET authentifié à faible fréquence (téléchargement humain). Cache mémoire = évolution triviale si un besoin réel apparaît (noté, non construit).
