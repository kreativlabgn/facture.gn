# Plan : Console DAF côté web — visa de liquidation + lecture des rails (Shell 3)

## Contexte projet
- Module : `apps/web` uniquement (surfaces utilisateur). Backend consommé tel quel — aucune route trust-api ajoutée ou modifiée.
- Persona affecté : DAF / chef de service dépense d'une administration cliente (`public_buyer_validator`), déjà introduit par le plan du 17/08. Aucun impact sur les personas PME.
- Données sensibles manipulées : montants agrégés d'encours fournisseurs d'une administration, références du circuit de la dépense. Pas de PII citoyen. Accès cross-organisation par construction — l'autorisation reste entièrement côté `PublicBuyerPortalService`.
- Impact réglementaire : aucun. La console enregistre un acte de l'administration cliente ; elle n'énonce jamais un visa propre à facture.gn (positionnement anti-R-02, cf. CLAUDE.md « tiers de confiance privé certifié »).

## Problème (en 3 lignes max)
Le portail acheteur public existe côté trust-api depuis le 17/08 (J1/J2) et le rail de financement B2G depuis le 19/08 (K4/K5), mais **aucune surface web ne les consomme** : un DAF n'a littéralement aucun écran. L'encours fournisseurs, le visa du service fait et l'état de cession des créances sont invisibles.

## Solution retenue (en 5 lignes max)
Route de premier niveau `/daf`, étanche comme `/cabinet` (son occupant n'est membre d'aucune organisation PME). Une page unique : encours total, puis une carte par facture reçue portant les trois signaux distincts (visa / paiement / litige), le volet de lecture des deux rails ADR-088, et le bouton de visa quand il a un sens. Toute la logique de décision vit dans `lib/daf.ts`, testée sans réseau.

## Alternatives écartées
- **Un formulaire d'affectation de partenaire financier dans la console DAF** — écartée, et c'est la décision structurante de ce plan. `POST /invoices/:id/financing` porte `@Roles("owner","admin")` avec la résolution d'organisation par défaut : un DAF n'étant `OrganizationMember` d'aucune PME, `RolesGuard` le rejetterait à chaque appel. Le plan du 19/08 le formule sans ambiguïté — « décide du rail — **jamais le DAF**, qui a déjà joué son rôle via `validateLiquidation()`, J1 ». Rendre ce formulaire ici imposerait soit un bouton qui échoue systématiquement, soit l'affaiblissement de l'autorisation d'un endpoint qui engage un montant réel de facture. Le choix du rail appartient à la PME : c'est sa créance qu'elle cède. Sa place est `/dashboard/invoices/[id]`, non traité ici.
- **Un bloc de calcul des frais de décaissement** — écartée : `payout_fee_djomy_bps` (ADR-089) n'existe nulle part dans ce dépôt (ni colonne, ni valeur, ni intégration Djomy Payout), et les plans du 09/08 et du 19/08 l'ont explicitement laissé hors scope (« un frais sur un virement qui n'a jamais lieu n'a aucun effet réel »). Le volet affiche donc la CHARGE (qui supporte les frais) sans jamais afficher de MONTANT de frais — inventer un chiffre sur un écran comptable serait pire que de ne rien afficher. Le net versé à la PME est, lui, exact et non calculé : ADR-089 interdit toute déduction sur le montant certifié.
- **Un écran de détail par facture** — écartée : aucune route `/public-buyer/invoices/:id` n'existe. Le détail obligerait à re-filtrer côté web une ligne déjà chargée.
- **Exposer take/skip dans l'UI** — écartée pour l'instant : le service plafonne à 100 et aucun compte réel n'en approche. L'encours total porte de toute façon sur le périmètre entier, pas sur la page.

## Travail livré
### `apps/web/src/lib/`
- `trust-api.ts` — `PublicBuyerInvoice`, `PublicBuyerInvoiceList`, `listReceivedInvoices()`, `validateLiquidation()`, `confirmCustomerLink()`. Messages de refus relayés tels quels (l'API les rend volontairement indistinguables pour ne pas devenir un oracle d'énumération).
- `daf.ts` — `railOf`, `isSecondaryFinancingLocked` (K5), `canValidateLiquidation`, `liquidationStage`, `netVerseALaPme`, `referenceDepense`. Toute la décision est ici, jamais dans un composant.
- `route-protection.ts` + `proxy.ts` — `/daf` ajouté aux deux, alignement vérifié par `route-protection.spec.ts`.

### `apps/web/src/app/daf/`
- `layout.tsx` — en-tête étanche, sortie par fermeture de session uniquement.
- `page.tsx` — console J1/J2.
- `actions.ts` — `validateLiquidationAction`, `confirmCustomerLinkAction`.
- `components/ArbitrageRails.tsx` — lecture des deux rails + verrou anti-double-nantissement.
- `components/CertifyLiquidationForm.tsx` — visa du service fait.

### Tests
- `lib/daf.spec.ts` (19) — dont trois sur `isSecondaryFinancingLocked` et deux sur `netVerseALaPme`, qui verrouillent les deux invariants financiers de l'écran.
- `app/daf/actions.spec.ts` (10) — identifiants transmis, 403/409 rendus lisibles, double envoi sans erreur (le service est idempotent).
- `financing.service.spec.ts` (+1) — deux demandes **simultanées** : une seule aboutit, l'autre rend un `getStatus() === 409`, et un seul `InvoiceEvent`. L'assertion porte sur le CODE HTTP, pas seulement la classe d'exception : sans `ExceptionFilter` dans cette application, c'est la seule garantie qu'un double clic ne dégénère pas en 500 opaque.

## Critères de done
- [x] `pnpm --filter web lint` / `typecheck` / `test` — 0, 0, 223 tests verts
- [x] `pnpm --filter trust-api lint` / `typecheck` / `test` — 0, 0, 1607 tests verts (couverture 92,94 %)
- [x] `pnpm --filter web build` — `/daf` enregistrée
- [x] `design-system.guardrails.spec.ts` vert (aucun hex en dur, aucun dégradé, aucun `text-navy-400`, `font-display` jamais sous 12 px)
- [x] Montants GNF rendus en `font-mono` (charte §Typographie)
- [x] Aucune donnée sensible loguée, aucun secret

## Reste à faire
- Revues `dev-code-reviewer`, `dev-security-reviewer` (accès cross-organisation), `dev-test-quality-analyzer` avant merge.
- **Arbitrage actif du rail côté PME** (`/dashboard/invoices/[id]`) — le pendant de ce plan, seul endroit où `POST /invoices/:id/financing` est appelable. Non traité ici.
- **Nom du fournisseur émetteur** — `listReceivedInvoices()` ne renvoie aucune relation `organization`, et ce persona n'a aucune route pour résoudre un `organizationId`. La console identifie donc les lignes par la référence du circuit de la dépense. Combler ce manque = un `include` côté trust-api, hors périmètre web.

## Risques identifiés & mitigations
- **Un futur contributeur ajoute un bouton de financement dans `/daf`** → mitigation : le refus est documenté en tête d'`ArbitrageRails.tsx` avec le motif d'autorisation, et `isSecondaryFinancingLocked()` porte la conclusion (pas la donnée) pour qu'on ne reteste jamais `financedByPartnerId` à la main ailleurs.
- **Une déduction de frais introduite un jour sur le net PME** → mitigation : `netVerseALaPme` a deux tests dédiés qui tombent au premier changement.
- **`text-navy-400` documenté par CLAUDE.md pour le ton neutre** alors que le garde-fou AA l'interdit → constat : `Badge` utilise déjà `navy-600`, la console passe par `Badge`, jamais par la classe directe.
