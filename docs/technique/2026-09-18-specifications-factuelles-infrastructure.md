# Spécifications techniques factuelles — intégrations partenaires

Statut : référence technique interne, vérifiée contre le code source au 2026-09-18.
Usage : appui pour rédiger, par vos soins, une correspondance ou une présentation
externe. Ce document n'est pas lui-même destiné à un tiers en l'état — voir les
réserves marquées ⚠️ avant toute reprise dans un support externe.

---

## 1. Webhook d'immatriculation synchrone (Guichet Unique APIP)

- **Endpoint :** `POST /v1/partners/apip/company-created` (`partners.controller.ts:16-31`).
  Seule route partenaire avec intégration technique réelle — les autres couples
  `partnerType/event` sont rejetés (400).
- **Authentification :** `PartnerWebhookAuthGuard` — en-tête `x-partner-key` comparé
  en temps constant (`timingSafeEqual`), plus signature HMAC-SHA256 du corps brut
  via l'en-tête `x-partner-signature`, secret unique `APIP_WEBHOOK_SECRET`
  (`partner-webhook-auth.guard.ts:1-63`).
- **Payload (Zod) :** `{ name, regimeFiscal, legalForm, nif, rccm }`
  (`create-from-apip.dto.ts:7-24`), avec garde métier : `regimeFiscal:
  non_assujetti_association` impossible si `legalForm ≠ association`.
- **Idempotence :** `OrganizationsService.createFromApip()` s'appuie sur DEUX
  contraintes d'unicité Postgres distinctes (`nif` et `rccm`), pas une seule — une
  redélivrance dont seul le NIF a été corrigé reste idempotente sur le RCCM et
  inversement. Un payload où NIF et RCCM pointent vers deux organisations
  différentes est explicitement rejeté (409), jamais résolu au hasard
  (`organizations.service.ts:379-439`).
- **Pas d'utilisateur fantôme :** le webhook crée uniquement l'organisation et sa
  clé de signature root ; aucun `User` n'est créé. L'organisation reste non
  réclamée jusqu'à l'authentification personnelle de l'entrepreneur.

---

## 2. Export comptable FEC

- **Format :** 18 colonnes tabulées conformes au format légal FEC
  (Article A47 A-1 du LPF) — `JournalCode, JournalLib, EcritureNum, EcritureDate,
  CompteNum, CompteLib, CompAuxNum, CompAuxLib, PieceRef, PieceDate, EcritureLib,
  Debit, Credit, EcritureLet, DateLet, ValidDate, Montantdevise, Idevise`
  (`fec-formatting.ts:1-23`).
- **Aucun flottant :** montants (`totalHt`, `totalTva`, `totalTtc`, montants de
  paiement) systématiquement `bigint` (centimes) de bout en bout
  (`fec-generation.ts:11-18`).
- **Une écriture par paiement**, jamais une ligne agrégée par facture — chaque
  règlement produit sa propre écriture de règlement (ADR-062).

⚠️ **Réserve à ne pas omettre :** le plan comptable utilisé (comptes 411/707/443/
571/521) est explicitement documenté dans le code comme une **hypothèse
OHADA/SYSCOHADA non validée par un expert-comptable** :
> « HYPOTHÈSE COMPTABLE OHADA/SYSCOHADA — à faire valider par un comptable avant
> toute mise en production réelle (aucune spec FEC/plan comptable propre au
> projet). » (`fec-generation.ts:20-22`)

Aucune compatibilité Sage/Odoo/SAP n'a été testée dans le code — le format FEC
est un format texte standard, mais l'interopérabilité effective avec ces
progiciels n'est pas vérifiée. Toute communication externe (DGI, OCAECG) doit
mentionner que la validation comptable est en cours, pas acquise.

---

## 3. Éligibilité au financement (rails B2G) — état réel, pas de marketplace bancaire

- **Prédicat `isFinanceable()`** (`is-financeable.ts:73-89`) : 7 conditions
  cumulatives — validation administrative, absence de cession déjà enregistrée,
  statut `issued`, créance non litigieuse et non déjà encaissée, compte
  acheteur public vérifié, lien de vérification confirmé au moment précis de la
  validation (durci suite à un audit de sécurité du 2026-08-23).
- **Ce qui existe :** `GET/POST /invoices/:id/financing` (`financing.controller.ts`),
  réservé owner/admin de l'organisation émettrice. La PME consulte les
  partenaires financiers disponibles pour SA facture et choisit d'enregistrer
  une cession (Rail A) ou de ne rien faire (Rail B — absence d'action, ADR-088).
- **Ce qui n'existe PAS :** aucun portail, aucune API, aucun endpoint côté
  banque/partenaire financier. Les 4 partenaires (Ecobank, UBA, COFINA, Akiba
  Finance) sont des lignes seedées en base, sans authentification ni accès
  self-service (`docs/plans/2026-08-19-b2g-financing-rail.md`). Il n'y a donc
  **aucune visibilité ni marketplace côté banque** — c'est la PME qui choisit,
  pas la banque qui découvre. Le décaissement effectif se fait entièrement hors
  plateforme, sur des rails bancaires externes non intégrés techniquement ici.
- **Étanchéité monétaire :** confirmée par absence — aucun module wallet, solde
  ou virement interbancaire dans le code (`apps/trust-api`, `apps/money-api`).

⚠️ Toute correspondance parlant d'un « Capital Layer » opérationnel doit être
formulée comme *calcul d'éligibilité et enregistrement de cession*, pas comme
plateforme de mise en relation bancaire en temps réel — cette dernière brique
n'est pas construite.

---

## 4. Canal USSD `*620#` — suggestion flash

- **Fenêtre d'éligibilité :** 30 minutes après émission (`FLASH_WINDOW_MS`,
  `ussd-flash-suggestion.service.ts:6`).
- **Critère de correspondance réel :** téléphone du client + statut
  (`issued`/`partially_paid`) + fenêtre de 30 min, facture la plus récente prise
  en priorité (`findCandidate()`, `ussd-flash-suggestion.service.ts:25-37`).
  ⚠️ Pas de correspondance sur le montant — contrairement à une éventuelle
  description en « clé composite téléphone + montant », seul le téléphone (plus
  la fenêtre de temps) est utilisé.
- **Recherche volontairement non scopée par organisation** (`findCandidate()`)
  car c'est le CLIENT qui s'authentifie, potentiellement client de plusieurs
  organisations distinctes — `markSuggested()`, lui, est bien scopé à
  l'organisation de la facture identifiée.
- **Masquage téléphone (RGPD) :** 3 premiers + 3 derniers chiffres de la partie
  locale (préfixe +224 retiré), le reste en `*` — format `620***233` confirmé
  dans `maskPhoneRgpd()` (`ussd-invoice-list.service.ts:14-28`). Un numéro local
  de 6 chiffres ou moins est masqué intégralement.

---

*Document technique interne — ne pas diffuser tel quel à un tiers sans revue.
Les sections marquées ⚠️ contiennent des réserves à intégrer explicitement dans
toute reprise externe du contenu.*
