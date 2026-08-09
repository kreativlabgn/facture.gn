# Plan : Exporter le FEC depuis le dashboard cabinet/CGA (F9)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — nouveau périmètre `fec/`, dépend de `mandates/` (F1/F5/F6/F7, mergées) pour l'accès croisé cabinet↔organisation
- Persona affecté : comptable agréé (Mamadou) exportant le FEC d'un client mandaté, OU une organisation exportant son propre FEC (`accountant_internal`/owner/admin)
- Données sensibles manipulées : données financières agrégées d'une organisation (montants, dates, structure comptable) — pas de PII individuelle nouvelle
- Impact réglementaire : **direct et fort** — OHADA/SYSCOHADA, conformité comptable. CdC §8 (critère de réception MVP) : *"FEC exportable sans rejet — 0 rejet sur fichier test anonymisé — Test logiciel comptable réel."*

## Investigation préalable — gap matériel identifié, tranché avec l'utilisateur
Backlog (texte complet, aucun bullet) : "F9 — Exporter le FEC depuis le dashboard cabinet/CGA `[MUST]`." Recherche exhaustive dans Backlog/DAT/CdC/ADR/PRD/ERD : **le format FEC exact (colonnes, plan comptable OHADA/SYSCOHADA) n'est spécifié nulle part** — seul le nom "FEC" et deux indices structurels :
- ADR-062 : *"Export FEC = N écritures par facture"* — un paiement partiel produit plusieurs écritures de règlement, pas une seule par facture.
- CdC §8 : critère de réception strict, *"0 rejet sur logiciel comptable réel"*.

**Décision actée avec l'utilisateur** (question posée explicitement avant de coder, gap trop matériel pour être deviné en silence) : implémenter la structure FEC légale standard (18 colonnes, Article A47 A-1 du LPF — norme la plus proche d'une définition publique et vérifiable disponible) avec un plan comptable OHADA/SYSCOHADA **documenté comme hypothèse explicite à faire valider par un comptable avant mise en production réelle** — jamais présenté comme déjà conforme sans validation humaine.

**2e gap découvert (F7)** : aucun mécanisme n'autorise encore un membre de cabinet à lire les données financières d'une organisation via son mandat — F1/F5/F6/F7 ont construit tout le cycle de vie du `Mandate`, zéro endpoint ne l'exploite encore pour une autorisation de lecture croisée. F9 est donc le premier consommateur réel de `Mandate.status = "active"` comme preuve d'autorisation.

## Format FEC retenu (18 colonnes, tabulation, UTF-8, 1 ligne = 1 écriture)
`JournalCode` · `JournalLib` · `EcritureNum` · `EcritureDate` (AAAAMMJJ) · `CompteNum` · `CompteLib` · `CompAuxNum` · `CompAuxLib` · `PieceRef` · `PieceDate` · `EcritureLib` · `Debit` · `Credit` · `EcritureLet` · `DateLet` · `ValidDate` · `Montantdevise` · `Idevise`

`CompAuxNum`/`CompAuxLib`/`EcritureLet`/`DateLet`/`Montantdevise`/`Idevise` toujours vides (aucun `Customer` individuel, aucun mécanisme de lettrage, aucune devise étrangère wired ici — hors scope, cohérent avec les exclusions déjà actées cette session pour E1/E4-E7).

## Plan comptable retenu (hypothèse à valider par un comptable — commentée explicitement dans le code)
| Compte | Libellé | Usage |
|---|---|---|
| 411 | Clients | Contrepartie de chaque facture émise et de chaque règlement |
| 707 | Ventes de marchandises | Produit HT de chaque facture (choix générique, faute de distinction sectorielle dans ce schema) |
| 443 | État, TVA facturée | TVA de chaque facture, uniquement si `totalTva > 0` |
| 571 | Caisse | Contrepartie des règlements `method: cash` |
| 521 | Banques locales | Contrepartie des règlements `method: bank_transfer` ou `payment_link` |

## Écritures générées, par facture éligible (`status ∈ {issued, partially_paid, paid}`, `documentType: invoice`)
1. **Écriture de vente** (JournalCode `VE`), datée `issuedAt`, `PieceRef: invoice.number` : débit 411 (`totalTtc`), crédit 707 (`totalHt`), crédit 443 (`totalTva`, ligne omise si 0).
2. **Écriture(s) de règlement** (JournalCode `CA` ou `BQ` selon `method`), une par `Payment` `status: completed` ET `depositType: null` (arrhes explicitement exclues, bucket financier séparé — même précédent que C5/C7/C13) : débit 571/521 (`payment.amount`), crédit 411 (`payment.amount`).

Hors scope explicite : avoirs (`CreditNote`)/remboursements (`Refund`) — nécessiteraient un journal `AV` et un traitement distinct (réduction de produit vs mouvement de trésorerie), pas construits ici, story future si confirmée. Aucun filtre de période — export intégral des factures éligibles de l'organisation, cohérent avec l'absence de tout filtre de date ailleurs dans ce repo.

## Solution retenue — accès (deux chemins, un seul endpoint)
`GET /organizations/:id/fec` — **aucun `@Roles()`** (l'autorisation combine deux systèmes RBAC distincts, RolesGuard ne couvre que l'un des deux) : vérification en ligne dans le service, autorise si (a) l'appelant est `OrganizationMember(organizationId, role ∈ {owner, admin, accountant_internal})`, **OU** (b) l'appelant est `PracticeMember` actif d'une `ProfessionalPractice` détenant un `Mandate(organizationId, status: active)` — premier usage réel du mandat comme preuve d'accès en lecture. Réponse : `text/plain` tabulé, `Content-Disposition: attachment`, jamais du JSON (le FEC est un fichier, pas une ressource API classique).

## Alternatives écartées
Deviner un format FEC "raisonnable" sans le signaler comme hypothèse — écartée explicitement par l'utilisateur (voir décision actée ci-dessus). Étendre `RolesGuard` avec un 3e système de résolution — écartée : la vérification combine déjà deux mécanismes existants (`OrganizationMember`, `Mandate`) via une logique OR simple, pas un nouveau concept RBAC ; greffer ça sur le guard partagé aurait mélangé deux modèles pour un bénéfice marginal (même raisonnement que F5/F6/F7). Inclure avoirs/remboursements dans cette story — écartée, complexité et ambiguïté comptable (réduction de produit vs mouvement de trésorerie) qui mérite sa propre story. Filtrer par période — écartée, aucun précédent de filtre de date dans ce repo, ajouté si le besoin se confirme.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/fec/fec-formatting.ts` (nouveau, fonction pure) — `formatFecLine(fields)` (échappement tabulation/formatage montant centimes→GNF 2 décimales), `FEC_HEADER` (18 en-têtes)
- [ ] Tâche 2 : `apps/trust-api/src/fec/fec-generation.ts` (nouveau, fonction pure) — `generateFecEntries(invoices)` : transforme une liste de factures (avec `lines`/`payments` inclus) en lignes d'écritures selon les règles ci-dessus, retourne un tableau de lignes déjà formatées (`string[]`), aucun accès DB
- [ ] Tâche 3 : `apps/trust-api/src/fec/fec.service.ts` (nouveau) — `export(organizationId, requesterUserId)` : vérifie l'autorisation (owner/admin/accountant_internal OU mandat actif), charge les factures éligibles avec `lines`/`payments`, appelle `generateFecEntries()`, retourne le texte final (header + lignes, jointes par `\n`)
- [ ] Tâche 4 : `apps/trust-api/src/fec/fec.controller.ts` + `fec.module.ts` (nouveaux) — `GET organizations/:id/fec`, réponse `text/plain` + `Content-Disposition`, câblage dans `app.module.ts`

## Tests à écrire AVANT le code
- [ ] Test 1 (`fec-formatting.spec.ts`) : une ligne FEC bien formée (18 champs séparés par tabulation, montant centimes→GNF avec 2 décimales, ex. `2000000` centimes → `20000.00`)
- [ ] Test 2 (`fec-generation.spec.ts`) : une facture sans TVA génère 1 écriture de vente à 2 lignes (débit 411, crédit 707) — aucune ligne 443
- [ ] Test 3 : une facture avec TVA génère 3 lignes (débit 411, crédit 707, crédit 443)
- [ ] Test 4 : une facture avec 2 paiements partiels (cash puis bank_transfer) génère 2 écritures de règlement distinctes (comptes 571 et 521 respectivement) — vérifie ADR-062 "N écritures par facture"
- [ ] Test 5 : un paiement `depositType: arrhes` n'est jamais inclus dans les écritures de règlement
- [ ] Test 6 : un paiement `status !== "completed"` (ex. `pending`/`failed`) n'est jamais inclus
- [ ] Test 7 (`fec.service.spec.ts`) : autorise l'owner de l'organisation
- [ ] Test 8 : autorise l'`accountant_internal` de l'organisation
- [ ] Test 9 : autorise un `PracticeMember` (même `accountant_external`, pas seulement `practice_admin` — ADR-070) dont la practice détient un `Mandate` `active` sur cette organisation
- [ ] Test 10 : refuse un `PracticeMember` dont le mandat est seulement `pending` (jamais accepté)
- [ ] Test 11 : refuse un utilisateur sans lien ni via `OrganizationMember` ni via un `Mandate` actif
- [ ] Test 12 : une facture `draft`/`voided`/`converted` n'apparaît jamais dans l'export

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune migration Prisma nécessaire
- code-reviewer OK
- security-reviewer recommandé (nouvel accès en lecture cross-organisation via mandat — surface IDOR à valider explicitement)
- **Limite assumée et documentée** : la conformité FEC réelle ("0 rejet sur logiciel comptable réel", CdC §8) ne peut PAS être vérifiée dans cet environnement (aucun logiciel comptable réel disponible) — testée uniquement structurellement (18 colonnes, équilibre débit/crédit par écriture). Validation humaine par un comptable requise avant mise en production, documentée explicitement dans le code et ce plan.

## Risques identifiés & mitigations
- Risque 1 (majeur, assumé) : le plan comptable (707/411/443/571/521) est une hypothèse, pas une donnée confirmée par un expert-comptable OHADA — mitigation : commentaire explicite dans `fec-generation.ts` marquant chaque compte comme HYPOTHÈSE, jamais présenté comme validé.
- Risque 2 : IDOR — un `PracticeMember` d'une practice SANS mandat actif sur l'organisation ciblée ne doit jamais accéder à son FEC → mitigation : test 11 dédié, revue sécurité recommandée.
- Risque 3 : un mandat `revoked` après avoir été `active` ne doit plus donner accès → mitigation : la vérification relit `Mandate.status` à chaque requête (jamais mis en cache), cohérent avec le principe déjà établi pour `OrganizationRole` ("jamais mis en cache dans le JWT").
