# Plan : Paliers de vélocité T0-T3 (D4)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`, + un champ sur `Organization`).
- Persona affecté : le système, en protection anti-fraude sur l'émission USSD.
- Impact réglementaire : LBC/FT (G1, déjà en place), même famille de contrôle.

## Investigation préalable

§4 Spec USSD (lue intégralement) :

| Palier | Par acte | Par jour | Par semaine | Par mois |
|---|---|---|---|---|
| T0 — non vérifié | 500 000 | 1 500 000 | 3 000 000 | 6 000 000 |
| T1 — vérifié DGI | 4 000 000 | 4 000 000 | 6 000 000 | 10 000 000 |
| T2 — T1+90j+0 flag | 20 000 000 | 20 000 000 | 50 000 000 | 100 000 000 |
| T3 — T2+12 mois | 80 000 000 | 80 000 000 | 200 000 000 | 400 000 000 |

« Le plus restrictif des deux plafonds (velocity_tier vs plafond opérateur) s'applique toujours. » — **plafond opérateur hors scope** : aucune donnée de plafond par opérateur Mobile Money n'existe dans ce repo, non construite ici (même limite qu'ADR-050 lui-même, qui ne fixe que la table velocity_tier).

**Deux inconnues techniques, résolues par déduction (documentées, pas cachées)** :
1. **« T1+90j »** exige un timestamp de passage à `verified` — `Organization.dgiVerificationStatus` existe (`organizations.service.ts:verifyDgi()`) mais AUCUN timestamp associé. Ajout de `Organization.dgiVerifiedAt`, posé au moment de la vérification.
2. **« 0 flag »** — seul concept de "flag" existant dans ce repo : `InvoiceEvent` de type `suspicious_cash_pattern_detected` (G1, `payments.service.ts`). « 0 flag » interprété comme : aucun événement de ce type pour l'organisation depuis `dgiVerifiedAt`. Appliqué identiquement à T3 (le texte ne le redit pas explicitement pour T3, mais rien n'indique qu'un flag devienne acceptable en progressant — cohérence retenue plutôt qu'un relâchement non signalé).

**Portée de l'application** : D4 est classée section D (canal USSD), pas section G (conformité générale) — cette tâche n'applique le contrôle QUE sur le chemin d'émission USSD (`UssdInvoiceService.emitInvoice`), pas sur `POST /invoices` (REST/PWA). Étendre au REST serait un chantier G séparé, hors du texte de cette story précise.

**Révision de G2** (`paymentsFrozenUntil`, déjà mergée cette session, réinterprétation provisoire faute de velocity_tier à l'époque) : §3.3 Spec USSD — « Reset PIN déclenche une bascule 24-48h vers T0 ». Le champ existant devient un signal d'entrée du calcul de palier (force T0 si dans le futur) PLUTÔT qu'un blocage total — mais **uniquement côté résolution de palier USSD** (`VelocityTierService`). Le blocage total existant dans `InvoicesService.issue()` (chemin REST/PWA) reste inchangé dans cette tâche — le réviser affecterait le comportement d'émission REST déjà en production logique et sort du périmètre D4 ; les deux mécanismes coexistent consciemment (bascule T0 en USSD, blocage dur en REST) jusqu'à une revue G2 dédiée ultérieure.

## Décision d'architecture

**`Organization.dgiVerifiedAt DateTime?`** — posé dans `OrganizationsService.verifyDgi()` au moment de la transition vers `verified`. Migration manuelle.

**`velocity-tier.ts`** (fonction pure, même style que `tax-regime.ts`/`commission-grid.ts`) :
```ts
function resolveVelocityTier(input: {
  dgiVerificationStatus: DgiVerificationStatus;
  dgiVerifiedAt: Date | null;
  hasAnomalyFlag: boolean;
  forcedT0Until: Date | null; // paymentsFrozenUntil
}): "T0" | "T1" | "T2" | "T3"
```
Table `VELOCITY_LIMITS_CENTIMES: Record<Tier, {perAct, perDay, perWeek, perMonth}>` (centimes GNF).

**`VelocityTierService`** (`ussd/velocity-tier.service.ts`) :
- `resolveTier(organizationId)` → charge `Organization` + compte les `InvoiceEvent` de type `suspicious_cash_pattern_detected` depuis `dgiVerifiedAt` → `resolveVelocityTier(...)`.
- `assertWithinLimits(organizationId, amountCentimes)` → résout le palier, calcule les sommes déjà émises (factures `issued`/`partially_paid`/`paid`, jamais `voided`/`draft`) sur jour/semaine/mois glissants + ce montant ; lève `ForbiddenException` explicite (quel plafond, quel palier) si dépassement de l'acte OU d'une fenêtre.

**Câblage** : `UssdInvoiceService.emitInvoice()` appelle `assertWithinLimits()` avant `createDraft()` — l'exception remonte jusqu'au handler de session, transformée en message USSD clair, jamais une facture partiellement créée.

## Alternatives écartées

**Étendre le contrôle à `POST /invoices` (REST/PWA)** — écartée pour cette tâche (voir investigation), périmètre G séparé.

**Réviser aussi le blocage dur de `InvoicesService.issue()` (REST)** — écartée pour cette tâche, même raisonnement — documentée comme coexistence consciente, pas un oubli.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `schema.prisma` — `Organization.dgiVerifiedAt`, migration ; `verifyDgi()` le pose
- [ ] Tâche 2 (RED) : `velocity-tier.spec.ts` — résolution T0→T3 selon DGI/ancienneté/flags/gel ; table des plafonds
- [ ] Tâche 3 (GREEN) : `velocity-tier.ts`
- [ ] Tâche 4 (RED) : `velocity-tier.service.spec.ts` — `assertWithinLimits` accepte sous plafond, refuse au-delà (acte, jour, semaine, mois séparément)
- [ ] Tâche 5 (GREEN) : `VelocityTierService`
- [ ] Tâche 6 : câblage dans `UssdInvoiceService.emitInvoice()` + message d'échec dans `UssdSessionService`

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Une organisation gelée (`paymentsFrozenUntil` futur) est traitée T0 en USSD, quel que soit son palier DGI réel

## Risques identifiés & mitigations
- Risque 1 : double comptage si une facture `partially_paid` compte à la fois dans la somme USSD et une future somme REST → non applicable ici (REST non couvert par cette tâche, voir portée).
- Risque 2 : `dgiVerifiedAt` rétroactivement absent pour les organisations déjà `verified` avant cette migration → traitées T0 tant qu'aucune revérification n'a lieu (comportement conservateur, jamais un palier supérieur non mérité) — limite acceptée, pas un backfill construit ici (aucune donnée fiable pour reconstituer la date réelle).
