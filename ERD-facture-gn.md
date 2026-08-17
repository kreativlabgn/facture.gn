# facture.gn — ERD

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Modèle de Données complet

| Champ | Valeur |
|---|---|
| Date | 26 juillet 2026 |
| Statut | Consolidé — 27 entités détaillées · 25 types d'événements (V2 inclus) · paramètres config étendus |
| Audience | Équipe technique, Tech Lead/Architecte |
| Documents liés | DAT · Registre ADR · Backlog |

> Schéma entités-relations complet — référence unique du modèle de données.

---

## 1. Vue relationnelle — chaîne de dépendances

PROFESSIONAL_PRACTICE (types : cabinet_comptable / gestionnaire / fiduciaire / cga) ── PRACTICE_MEMBER ── USER ; MANDATE ── ORGANIZATION.

ORGANIZATION ── ORGANIZATION_DELEGATED_KEY, BRANCH, PRODUCT ── PRODUCT_STOCK ── BRANCH, CUSTOMER, RECURRING_INVOICE_TEMPLATE, PARTNER_LINK, INVOICE ── INVOICE_LINE, PAYMENT ── PAYMENT_PROVIDER_ATTEMPTS, INVOICE_EVENT, CREDIT_NOTE ── CREDIT_NOTE_LINE, REFUND ── CREDIT_NOTE.

SHORT_CODE_INDEX ── INVOICE (via certification_id). ASSISTED_SESSION ── ORGANIZATION. REVENUE_SHARE ── PROFESSIONAL_PRACTICE × ORGANIZATION. PARTNER ── PARTNER_LINK ── ORGANIZATION. PAYMENT_WEBHOOKS (table autonome, dédupliquée par provider_ref). CONFIG_PARAMETER (table autonome, versionnée).

---

## 2. Entités — schéma détaillé

### 2.1 Contexte organisationnel

#### USER

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| name | string | |
| password_hash | string | Nullable — auth PIN via USER_PHONE pour le canal USSD |
| preferred_language | enum | fr / pular / malinke / soussou |
| created_at | timestamp | |

#### USER_PHONE (ADR-087, nouveau — multi-numéros)

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | → USER |
| msisdn | string | Unique, indexé pour la résolution USSD |
| is_primary | boolean | Défaut false — un seul numéro primaire par utilisateur |
| verified_at | timestamp | Nullable |

Remplace l'ancien champ `phone` unique sur USER — un même utilisateur est désormais reconnu sur plusieurs numéros (ADR-087), sans ressaisir de code compte à chaque changement de téléphone. Aucun impact sur la clé cryptographique, toujours par organisation et par canal (ADR-026), jamais par numéro.

#### ORGANIZATION

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| name | string | NOT NULL |
| regime_fiscal | enum | normal_tva / tpu / normal_sans_tva / non_assujetti_association |
| legal_form | enum | commercial / association |
| nif | string | Unique, NOT NULL |
| etax_number | string | Nullable (inscription incomplète B4, ou canal partenaire ADR-077) |
| rccm | string | Nullable |
| registration_source | enum | organic / apip / cga_referral / fodip / partner_3ae / agent_terrain (ADR-077, ADR-107) |
| dgi_verification_status | enum | unverified / pending / verified |
| bank_account_details | jsonb | Nullable |
| preferred_language | enum | fr / pular / malinke / soussou |
| chiffre_affaires_brut_declare | bigint | Centimes GNF |
| payment_link_auto_send | boolean | Défaut true (C20) |
| commercial_tier | enum | freemium / starter / pro / enterprise / custom |
| created_at | timestamp | |

#### ORGANIZATION_DELEGATED_KEY

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | → ORGANIZATION |
| channel | enum | pwa / ussd / terrain_offline (V2) |
| public_key | bytea | Ed25519 |
| delegation_certificate | bytea | Signé par clé racine |
| velocity_tier | enum | T0 / T1 / T2 / T3 |
| limit_per_act | bigint | Centimes GNF |
| limit_per_day | bigint | |
| limit_per_week | bigint | |
| limit_per_month | bigint | |
| revoked_at | timestamp | Nullable |

#### BRANCH

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | → ORGANIZATION |
| name | string | |
| type | enum | boutique / entrepot / agence / en_ligne |

### 2.2 Écosystème cabinet

#### PROFESSIONAL_PRACTICE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| type | enum | cabinet_comptable / gestionnaire / fiduciaire / cga (4e valeur, ADR-078) |
| name | string | NOT NULL |
| registration_number | string | Nullable (n° Ordre OCAECG, agrément CGA, ou RCCM) |
| ordre_verified | boolean | Défaut false |
| tier | enum | partner_free / partner_starter / partner_pro / partner_institutional |
| phone | string | |
| email | string | Nullable |
| created_at | timestamp | |

#### PRACTICE_MEMBER

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| practice_id | uuid FK | → PROFESSIONAL_PRACTICE |
| user_id | uuid FK | → USER |
| role | enum | practice_admin / accountant_external / business_manager |
| permissions_override | jsonb | Nullable |
| joined_at | timestamp | |
| left_at | timestamp | Nullable — peuplé quand le membre quitte |

#### MANDATE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| practice_id | uuid FK | → PROFESSIONAL_PRACTICE |
| organization_id | uuid FK | → ORGANIZATION |
| status | enum | pending / active / revoked / expired |
| granted_role | enum | accountant_external / business_manager |
| permissions_override | jsonb | Nullable |
| granted_by | uuid FK | → USER (owner/admin qui a accepté) |
| requested_at | timestamp | |
| granted_at | timestamp | Nullable |
| expires_at | timestamp | Nullable |
| revoked_at | timestamp | Nullable |
| revocation_reason | string | Nullable |

#### REVENUE_SHARE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| practice_id | uuid FK | → PROFESSIONAL_PRACTICE |
| organization_id | uuid FK | → ORGANIZATION |
| period_month | integer | YYYYMM |
| total_platform_fees_gnf | bigint | Centimes GNF |
| share_amount_gnf | bigint | Centimes GNF |
| share_rate_bps | integer | Basis points (1000 = 10%) |
| status | enum | calculated / credited / paid_out |
| calculated_at | timestamp | |
| credited_at | timestamp | Nullable |

### 2.3 Partenaires institutionnels

#### PARTNER (ADR-078)

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| type | enum | apip / fodip / partner_3ae |
| name | string | NOT NULL |
| convention_ref | string | Nullable |
| status | enum | active / suspended / expired |
| created_at | timestamp | |

Le CGA n'utilise pas la table PARTNER — il est modélisé comme un 4e type de PROFESSIONAL_PRACTICE (ADR-078), pour réutiliser directement le mécanisme mandate/dashboard/revenue_share déjà construit pour les cabinets comptables.

#### PARTNER_LINK

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| partner_id | uuid FK | → PARTNER |
| organization_id | uuid FK | → ORGANIZATION |
| link_type | enum | referral / subvention |
| status | enum | pending / active / expired |
| linked_at | timestamp | |

#### FINANCIAL_PARTNER (ADR-089, nouveau — V2)

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| name | string | NOT NULL |
| type | enum | banque / mfi / fournisseur_crediteur (ADR-100 — acteur commercial non agréé, mandat boutique requis avant toute visibilité du score de confiance) |
| api_key | string | Nullable, portail bancaire dédié |
| status | enum | active / suspended |
| created_at | timestamp | |

Structurellement distincte de `PARTNER` (institutionnel léger : apip/fodip/partner_3ae, webhook ou lecture seule) — une banque a des besoins différents : API dédiée, KYC, conditions de financement. Partenaires initiaux identifiés : Ecobank (banque), UBA (banque), COFINA (mfi), Akiba Finance (mfi).

### 2.4 Facturation

#### INVOICE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | → ORGANIZATION |
| branch_id | uuid FK | → BRANCH (nullable) |
| customer_id | uuid FK | → CUSTOMER (nullable pour anonyme) |
| number | string | FG-YYYY-NNNNNN, unique par org/année |
| certification_id | string | GN-{NIF8}-{YYYY}-{HASH6}, unique global |
| document_type | enum | invoice / proforma / quote |
| status | enum | draft / issued / partially_paid / paid / voided / converted / expired |
| dispute_status | enum | none / disputed / resolved |
| validated_by_administration | boolean | V1 (avancé par ADR-098), défaut false — déclenché par liquidation_validated (ADR-080/081) ; sans consommateur avant V2 (is_financeable(), ADR-088/089) |
| total_ht | bigint | Centimes GNF |
| total_tva | bigint | Centimes GNF |
| total_ttc | bigint | Centimes GNF — montant certifié signé |
| discount_pct | integer | Basis points, après lignes avant TVA |
| amount_paid | bigint | Centimes GNF — somme des payments |
| amount_due | bigint | Centimes GNF — total_ttc - amount_paid |
| overpayment_amount | bigint | Centimes GNF — défaut 0, cash uniquement |
| payment_link_url | string | Nullable, jamais dans le payload signé |
| payment_link_id | string | Nullable, ID provider (Djomy ou Moneroo) |
| payment_link_expires_at | timestamp | Nullable, TTL 30j par défaut |
| reference_currency/amount/fx_rate/fx_rate_date | — | Nullable, informatifs (ADR-055) |
| recurring_template_id | uuid FK | Nullable → RECURRING_INVOICE_TEMPLATE |
| converted_to_invoice_id | uuid FK | Nullable, pour proforma/devis converti |
| quote_valid_until | date | Nullable, expiration devis |
| reference_marche | string | Nullable — référence d'attribution TELEMO recopiée manuellement par la PME (ADR-090), aucune vérification automatique |
| financed_by_partner_id | uuid FK | Nullable → FINANCIAL_PARTNER — présence seule bloque un second financement (ADR-089, V2) |
| financed_at | timestamp | Nullable, V2 |
| hash / previous_hash / signature | — | SHA-256, chain.prev, Ed25519 |
| issued_at | timestamp | Nullable (peuplé à l'émission) |
| created_at | timestamp | |

#### INVOICE_LINE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| invoice_id | uuid FK | → INVOICE |
| product_id | uuid FK | → PRODUCT (nullable) |
| description | string | |
| quantity | integer | |
| unit_price | bigint | Centimes GNF |
| tax_rate_bps | integer | Hérité de product.tax_exemption_category |
| cost_price_at_time | bigint | Nullable, centimes GNF — snapshot de PRODUCT.cost_price à la création de la ligne, jamais recalculé rétroactivement (ADR-084, même pattern que tax_rate_bps) |

#### PAYMENT

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| invoice_id | uuid FK | → INVOICE |
| amount | bigint | Centimes GNF — ce que le marchand reçoit |
| amount_collected | bigint | Centimes GNF — ce que le payeur a payé |
| platform_fee_amount | bigint | Centimes GNF — commission facture.gn |
| gateway_fee_amount | bigint | Centimes GNF — frais gateway (Djomy 1% ou Moneroo) |
| method | enum | cash / payment_link / bank_transfer |
| provider_sub_method | enum | Nullable : orange_money / mtn_momo / card / wave |
| deposit_type | enum | Nullable : arrhes / acompte |
| provider_ref | string | Nullable, ref Djomy/Moneroo/opérateur |
| status | enum | pending / completed / failed |
| idempotency_key | uuid | Unique, TTL 24h |
| collected_at | timestamp | |

#### PAYMENT_PROVIDER_ATTEMPTS (ADR-076, nouveau 26/07)

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| invoice_id | uuid FK | → INVOICE |
| provider | enum | djomy / moneroo / orange_direct / mtn_direct |
| status | enum | pending / success / failed / timeout |
| provider_ref | string | Référence externe |
| amount_gnf | bigint | |
| fee_gateway | bigint | 1% Djomy ou équivalent Moneroo |
| fee_platform | bigint | Notre commission |
| created_at | timestamp | |
| settled_at | timestamp | Nullable |

#### PAYMENT_WEBHOOKS (ADR-075, nouveau 26/07)

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| provider | enum | djomy / moneroo |
| provider_ref | string | Dedupe key |
| payload | jsonb | Raw webhook |
| normalized_status | enum | paid / failed / pending |
| processed_at | timestamp | Idempotency guard |
| signature_valid | boolean | |

#### CREDIT_NOTE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| invoice_id | uuid FK | → INVOICE |
| amount | bigint | Centimes GNF |
| refund_multiplier | integer | 1 ou 2 (arrhes + annulation pro) |
| reason | string | |
| created_at | timestamp | |

#### CREDIT_NOTE_LINE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| credit_note_id | uuid FK | → CREDIT_NOTE |
| invoice_line_id | uuid FK | → INVOICE_LINE |
| quantity_returned | integer | |

#### REFUND

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| credit_note_id | uuid FK | → CREDIT_NOTE |
| invoice_id | uuid FK | → INVOICE |
| amount | bigint | Centimes GNF |
| method | enum | cash / payment_link_payout / bank_transfer / credit_on_account |
| provider_ref | string | Nullable (pour payment_link_payout — Djomy Payout, fallback Moneroo) |
| status | enum | pending / completed / failed |
| created_at | timestamp | |
| completed_at | timestamp | Nullable |

#### INVOICE_EVENT

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| invoice_id | uuid FK | → INVOICE |
| type | enum | 23 types MVP/V1 + 2 types V2 B2G (25 au total — voir DAT §4.1) |
| actor_id | uuid FK | Nullable — public_buyer_validator pour liquidation_validated (V1, avancé par ADR-098) |
| amount | bigint | Nullable, centimes GNF |
| metadata | jsonb | Nullable, données contextuelles |
| created_at | timestamp | Append-only, jamais modifié |

### 2.5 Catalogue et clients

#### PRODUCT

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | → ORGANIZATION |
| name | string | |
| tax_exemption_category | string | Nullable |
| cost_price | bigint | Nullable, centimes GNF — coût d'achat (ADR-084), n'a jamais bloqué la création d'un produit |

#### PRODUCT_STOCK

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| product_id | uuid FK | → PRODUCT |
| branch_id | uuid FK | → BRANCH |
| stock_qty | integer | Nullable |

#### CUSTOMER

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | → ORGANIZATION |
| name | string | |
| phone | string | Nullable |
| nif | string | Nullable |
| is_public_entity | boolean | Défaut false ; V1 (avancé par ADR-098, prérequis du Niveau 2 B2G — DAT §8) |
| credit_limit | bigint | Nullable, centimes GNF |
| running_balance | bigint | Calculé sur amount_due, centimes GNF |
| public_buyer_account_id | uuid FK | Nullable ; V1 (avancé par ADR-098) — identité DAF/administration |
| possible_duplicate_of | uuid FK | Nullable → CUSTOMER |

### 2.6 Support

#### RECURRING_INVOICE_TEMPLATE

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | → ORGANIZATION |
| frequency | enum | daily / weekly / monthly / yearly |
| line_items | jsonb | Lignes types — jamais de taux/régime figé |
| next_generation_date | date | |

#### SHORT_CODE_INDEX

| Champ | Type | Contrainte |
|---|---|---|
| short_code | string PK | 8 car. Base32, unique, collision vérifiée |
| certification_id | string FK | → INVOICE.certification_id |

#### ASSISTED_SESSION

| Champ | Type | Contrainte |
|---|---|---|
| id | uuid PK | |
| agent_id | uuid FK | → USER |
| organization_id | uuid FK | → ORGANIZATION |
| consent_recorded | boolean | |
| created_at | timestamp | |

---

## 3. Notes de lecture

- Modèle passé de 21 à 27 entités détaillées le 26/07 : +2 pour l'orchestrateur paiement (PAYMENT_PROVIDER_ATTEMPTS, PAYMENT_WEBHOOKS — ADR-075/076), +2 pour les partenaires institutionnels (PARTNER, PARTNER_LINK — ADR-078), +3 pour le multi-numéros et le financement B2G (USER — jamais détaillée avant, USER_PHONE — ADR-087, FINANCIAL_PARTNER — ADR-089).
- PRODUCT.cost_price et INVOICE_LINE.cost_price_at_time ajoutés lors des travaux sur la Grille des Offres (ADR-084) — pas de nouvelle entité, deux champs sur des tables existantes. Le snapshot sur INVOICE_LINE évite qu'un changement de coût déforme rétroactivement les rapports de marge passés.
- PARTNER/PARTNER_LINK (ADR-078) couvrent APIP/FODIP/3AE ; le CGA n'y figure pas — il est un 4e type de PROFESSIONAL_PRACTICE pour réutiliser mandate/revenue_share tels quels.
- INVOICE_EVENT.type : 23 types confirmés au catalogue MVP/V1 (DAT §4.1), dont liquidation_validated avancé de V2 par ADR-098 pour rester cohérent avec le Niveau 2 B2G déjà positionné V1 (ADR-080). 2 types V2 restants (service_fait_confirmed, financing_disbursed — ADR-089) portent le total à 25.
- CUSTOMER.is_public_entity et CUSTOMER.public_buyer_account_id passent V2 → V1 (conséquence d'ADR-098, non explicitée dans ses conséquences d'origine mais structurellement requise) : le Niveau 2 B2G ne peut identifier une facture comme B2G sans ces deux champs, or le portail qui le consomme est déjà V1 (DAT §8). INVOICE.validated_by_administration suit — V1 également, sans consommateur avant V2 (is_financeable(), ADR-088/089).
- USER_PHONE (ADR-087) et FINANCIAL_PARTNER (ADR-089) portent le modèle de 24 à 26 entités détaillées. FINANCIAL_PARTNER reste distincte de PARTNER — une banque n'est jamais modélisée comme un partenaire institutionnel léger.
- payment.method reste à 3 valeurs (cash/payment_link/bank_transfer) ; le rail spécifique vit dans provider_sub_method — jamais confondu avec payment_provider_attempts.provider (couche orchestrateur technique).
- REFUND.method utilise déjà un enum provider-agnostique (payment_link_payout) — la bascule Djomy primary/Moneroo fallback (26/07) ne change aucun schéma, seulement la prose narrative des autres documents.

---

*facture.gn — ERD — Document confidentiel — 17 août 2026*
