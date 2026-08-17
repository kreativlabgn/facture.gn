# facture.gn — DAT

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Document d'Architecture Technique — référence technique unique

| Champ | Valeur |
|---|---|
| Date | 8 août 2026 |
| Statut | Consolidé — orchestrateur Djomy/Moneroo, grille tarifaire 5 paliers, partenaires institutionnels, B2G, multi-numéros, Commande Publique, financement, TELEMO, fenêtre d'accueil Freemium (ADR-092) |
| Audience | Équipe technique, Tech Lead/Architecte, squads de développement |
| Documents liés | PRD · Backlog · Registre ADR (ADR-001 à ADR-094) · Spec USSD · Risques-RACI · ERD · Grille-Offres |

> Référence technique unique de facture.gn.

---

## 1. Stack technique

| Couche | Choix | Notes |
|---|---|---|
| Frontend web | Next.js 14 (PWA) | Offline-first, Workbox, App Shell |
| Frontend mobile | React Native | Partage du core métier avec la PWA |
| Backend API | NestJS (Node 20 LTS) | Guards RBAC, Zod validation, OpenAPI auto-généré |
| Cert-Engine | Rust, service isolé | 12k signatures/s vs 800 en Node ; isolation des clés |
| Base de données | PostgreSQL 16 + TimescaleDB | RLS par organisation + par practice (cabinet/CGA) |
| Cache / Queue | Redis 7 Cluster, BullMQ | Idempotence, sessions, rate limit |
| Money Mesh | Service Node séparé | Orchestrateur multi-provider (ADR-073) — isole les pannes Djomy/Moneroo |
| Providers paiement | Djomy.africa (primary) + Moneroo (fallback) | OM/MTN GN directs via Djomy ; cartes intl + failover via Moneroo (ADR-072) |
| Recherche | Meilisearch | Suffisant au volume visé (1M docs) |
| Stockage objet | MinIO — WORM + object lock 10 ans | Preuves, PDF/A archivage |
| Infra | Kubernetes OVH Gravelines (3 AZ) + edge Conakry | Frontend Vercel |
| Crypto | HSM cloud (KMS) prod, HSM logiciel hors prod | Ed25519, SHA-256, rotation 365j |
| Feature flags | ConfigCat | Rollout progressif, expiration 90j max |
| Observability | OpenTelemetry → Prometheus + Grafana + Loki | Correlation IDs bout en bout |
| Secrets | HashiCorp Vault | Transit encryption, audit, rotation, Shamir 3-de-5 ; clés webhooks partenaires (ADR-082) |
| Vérification publique | IPFS + Cloudflare | Pinning financé 10 ans |

---

## 2. Architecture & modules — bounded contexts

Principe non négociable : services séparés par bounded context, jamais un monolithe — isolation des pannes entre signature cryptographique haute fréquence et orchestration de paiements multi-opérateurs.

### 2.1 Trust Context (Squad Trust)

IAM · Organisations multi-tenant · Facturation Core (invoice, proforma, devis, avoir, remboursement) · Trust Layer / Certification (Ed25519, chaînage SHA-256) · Vérification publique (verify.facture.gn).

### 2.2 Money Context (Squad Money)

Orchestrateur de paiement multi-provider — interface PaymentProvider unique (ADR-073), Djomy primary + Moneroo fallback (ADR-072), circuit breaker 10s. Paiement partiel. Commission Money (calcul, capture, ventilation, grille 5 paliers ADR-074). Offline & Sync Engine (CRDT). Canaux d'inclusion (USSD *620#, vocal multilingue, OCR).

### 2.3 Capital Context (Squad Capital) — V1/V2

Catalogue · Portail client · Comptabilité & Cabinet/CGA (dashboard multi-org, mandats, revenue share) · Analytics / Scoring / Reporting · Export & Intégrations (FEC, UBL 2.1) · B2G / Factoring — V2 uniquement. Portail admin publique — Niveau 2 de validation DAF entre en V1 (ADR-080), le reste (scoring, is_financeable() opérationnel) reste V2. Portail bancaire / MFI (vérification, anti-double nantissement).

### 2.4 Platform Context (Squad Platform)

RBAC & Audit (9 rôles MVP, 19 V1, 20 V2 — ADR-098) · Notifications (WhatsApp Business API, SMS — rappels, liens de paiement, mandats) · Admin & Ops Platform · Authentification webhooks partenaires (API key + HMAC-SHA256, ADR-082).

---

## 3. RBAC — trois paliers révisés

Principe : un rôle = une capacité distincte, jamais de redondance. Presets métier (freelancer, hotel_receptionist) = templates d'onboarding, pas des rôles en base.

### 3.1 MVP — 9 rôles

owner · admin · accountant_internal · cashier · field_agent · delivery_driver · client_portal · accountant_external (avancé du V1 — 12 pilotes Mamadou) · practice_admin (nouveau — gestion cabinet/CGA).

### 3.2 V1 — 19 rôles

Ajout : business_manager · inventory_manager · approver · auditor · viewer · tax_controller_readonly · support · sysadmin · developer_api · public_buyer_validator (accès cross-org acheteur public — DAF authentifié via public_buyer_account, ADR-080, avancé de V2 par ADR-098).

### 3.3 V2 — 20 rôles

platform_compliance_officer (transverse, 2FA obligatoire).

### 3.4 Permissions

54 permissions au MVP + 7 permissions cabinet/CGA (practice:manage, practice:invite_member, practice:view_billing, practice:view_revenue_share, mandate:request, mandate:accept, mandate:revoke) = 61 au MVP. En V1, +4 permissions issues des travaux Grille des Offres (ADR-083/084) : customer:merge_duplicate, customer:manage_credit_limit, customer:flag_public_entity, analytics:view_margin — sous-total 65. +3 permissions issues des rôles V1 fantômes (ADR-097) : inventory:manage_stock, audit:view_log, api:manage_keys — total 68 en V1. 69e (compliance:manage_declarations) en V2. `sysadmin` reste hors de ce catalogue — rôle interne, jamais assignable à une PME cliente (ADR-097). Mécanisme cross_tenant_grant (V2, et réutilisé en V1 pour le support client — ADR-085) pour tout accès transverse.

### 3.5 Accès délégué

Cabinet comptable ou CGA : mandat (professional_practice → organization), révocable, collaborateurs héritent. Agent terrain : assisted_session, jamais de membership persistant. Proche/assistant : viewer, invitable depuis *620#. Principe : aucun accès délégué ne partage jamais le PIN du propriétaire.

**Cas distinct — client_portal (ADR-096)** : n'est pas un accès délégué. Identité auto-résolue par téléphone vérifié (USER_PHONE, ADR-087), transverse à toutes les organisations, que l'organisation émettrice ne peut jamais révoquer — seul le client contrôle son propre numéro.

---

## 4. Modèle de données — entités canoniques

Source unique de vérité. Tous les champs clés et invariants sont définis ici ; les autres documents y renvoient. Détail complet du schéma dans l'ERD dédié.

| Entité | Champs clés (extrait) | Invariant |
|---|---|---|
| user / user_phone | msisdn, is_primary, verified_at | Un même utilisateur reconnu sur plusieurs numéros (ADR-087, MVP) ; jamais confondu avec la clé cryptographique, toujours par organisation/canal (ADR-026) |
| organization | regime_fiscal (4 valeurs), legal_form, registration_source (ADR-077), rccm, dgi_verification_status, commercial_tier | Régime fiscal obligatoire, jamais un défaut TVA silencieux |
| organization_delegated_key | organization_id, channel, public_key, velocity_tier, plafonds par fenêtre | Jamais de clé partagée ; réémis à chaque changement de palier |
| professional_practice | type (cabinet_comptable/gestionnaire/fiduciaire/cga — ADR-078), registration_number, tier | Entité de premier niveau, parallèle à organization (ADR-068) |
| partner / partner_link | type (apip/fodip/partner_3ae), convention_ref, link_type | Couvre APIP/FODIP/3AE — le CGA utilise professional_practice, pas cette table (ADR-078) |
| financial_partner | type (banque/mfi), api_key, status | Nouveau (ADR-089, V2) — distincte de partner : une banque a des besoins différents (API dédiée, KYC) |
| mandate | practice_id, organization_id, status, granted_role, expires_at | Consentement explicite obligatoire (ADR-069) |
| revenue_share | practice_id, organization_id, share_amount_gnf, share_rate_bps | Calcul quotidien, crédit mensuel (ADR-071) |
| invoice | certification_id, document_type, status (7 valeurs), validated_by_administration (V2), reference_marche (nullable), financed_by_partner_id (V2) | Deux identifiants distincts ; immutable après émission |
| payment | amount, amount_collected, platform_fee_amount, gateway_fee_amount, method, provider_sub_method | Immuable après collecte ; méthodes manuelles restreintes cash/virement (ADR-061) |
| payment_provider_attempts | invoice_id, provider (djomy/moneroo/orange_direct/mtn_direct), status, fee_gateway | Nouveau 26/07 (ADR-076) — traçabilité par tentative, y compris bascules |
| payment_webhooks | provider, provider_ref, normalized_status, processed_at | Nouveau 26/07 (ADR-075) — processed_at = clé d'idempotence |
| invoice_event | invoice_id, type (25 types au total, dont 2 V2 B2G — ADR-098), actor_id | Append-only, source de vérité audit (ADR-015) |
| refund | credit_note_id, amount, method (payment_link_payout) | Exige toujours un credit_note préalable (ADR-063) |
| customer | is_public_entity (V2), running_balance, public_buyer_account_id (V2) | — |
| recurring_invoice_template | organization_id, fréquence, lignes types | Ne stocke jamais de taux/régime figé (ADR-056) |

### 4.1 Événements invoice_event — catalogue complet

22 types confirmés au périmètre MVP/V1 (la mention « 25 types » d'une version antérieure du tableau d'entités était une coquille, corrigée). Les 3 types marqués V2 ci-dessous s'ajoutent pour le B2G (ADR-081, ADR-089), portant le total à 25.

| Type | Déclencheur |
|---|---|
| cancellation_indemnity | Exercice du dédit (arrhes) |
| no_show_forfeited | No-show hôtelier |
| dispute_raised | Client conteste |
| dispute_resolved | Contestation résolue |
| payment_reminder_sent | Rappel automatique post-échéance |
| payment_link_generated | Émission ou régénération de lien |
| payment_link_expired | TTL 30j atteint |
| payment_link_regenerated | Régénération manuelle |
| invoice_voided | Annulation sans paiement |
| invoice_converted | Proforma/devis → facture |
| overpayment_recorded | Trop-perçu cash |
| refund_issued | Remboursement enregistré |
| suspicious_cash_pattern_detected | Détection comportementale anti-fuite |
| stale_invoice_detected | >90j sans paiement ni action |
| mandate_requested | Cabinet/CGA demande accès |
| mandate_granted | Owner accepte |
| mandate_revoked | Révocation |
| mandate_expired | Expiration automatique |
| revenue_share_credited | Revenue share mensuel crédité |
| regime_change | Changement de régime fiscal |
| delegated_key_tier_changed | Changement de palier de vélocité |
| validation_revoked | Révocation sous-clé cryptographique terrain (V2, Trust Layer — sans lien avec le B2G) |
| liquidation_validated | V2 — DAF valide la liquidation d'une facture B2G (ADR-080/081) |
| service_fait_confirmed | V2, optionnel — confirmation Niveau 1 du service fait (ADR-080) |
| financing_disbursed | V2 — avance débloquée par un FINANCIAL_PARTNER, Rail A (ADR-088/089) |

### 4.2 Paramètres config versionnés (ADR-058)

Tous les paramètres susceptibles de changer vivent en table de configuration versionnée, jamais en dur dans le code.

| Paramètre | Valeur initiale | Notes |
|---|---|---|
| commission_freemium_displayed_bps | 250 (2,5%) | Grille 5 paliers (ADR-074) — révise l'ancienne valeur unique 150bps |
| commission_freemium_target_bps | 200 (2,0%) | Taux cible négociation |
| commission_freemium_onboarding_displayed_bps / target_bps | 200 / 150 | Nouveau (ADR-092) — aligné sur le tarif Starter pendant la fenêtre d'accueil, remplace commission_freemium_displayed_bps/target_bps le temps de la fenêtre |
| freemium_onboarding_window_days | 90 | Nouveau (ADR-092) — durée max de la fenêtre d'accueil |
| freemium_onboarding_invoice_threshold | 20 | Nouveau (ADR-092) — factures certifiées réglées par lien ; le premier des deux seuils (jours ou factures) atteint déclenche la bascule vers le tarif Freemium standard |
| commission_starter_displayed_bps / target_bps | 200 / 150 | 2,0% / 1,5% |
| commission_pro_displayed_bps / target_bps | 150 / 100 | 1,5% / 1,0% |
| commission_enterprise_displayed_bps / target_bps | 120 / 100 | 1,2% / 1,0% |
| commission_custom_displayed_bps / target_bps | 100 / 80 (floor) | 1,0% / 0,8% |
| commission_cap_freemium_gnf / starter_gnf | 5 000 000 centimes (50 000 GNF) chacun | — |
| commission_cap_pro_gnf | 7 500 000 centimes (75 000 GNF) | — |
| commission_cap_enterprise_gnf | 10 000 000 centimes (100 000 GNF) | — |
| commission_cap_custom_gnf | 15 000 000 centimes (150 000 GNF) | — |
| gateway_fee_djomy_bps | 100 (1%) | Frais gateway Djomy, ajouté au total payeur (ADR-074) |
| payout_fee_djomy_bps | À confirmer | Nouveau (ADR-089) — uniforme sur refund, revenue share cabinet, avance B2G Rail A. Porté par la banque sur le Rail A, jamais déduit de ce que la PME reçoit |
| payment_link_ttl_days | 30 | Expiration lien de paiement |
| stale_invoice_threshold_days | 90 | Tag « dormante » |
| cash_proof_threshold_gnf | 100 000 000 centimes (1M GNF) | Seuil photo/GPS obligatoire |
| revenue_share_rate_bps | 1000 (10%) | Part commission reversée au cabinet/CGA |
| revenue_share_cap_per_client_gnf | 500 000 centimes (5 000 GNF/mois/client) | Plafond anti-abus |
| partner_free_org_limit | 10 | Max organisations en Partner Free |
| mandate_invitation_ttl_days | 30 | Expiration lien invitation |
| seuil_regime_tpu_gnf / tva_gnf | 150M / 1Md GNF | À reconfirmer |
| credit_limit_approval_threshold_gnf | À confirmer | ADR-083 — au-delà, validation approver obligatoire |

---

## 5. Trust Layer — certification et clés déléguées

### 5.1 Chaînage

chain.prev est un champ du payload signé. H = SHA256(canonicalize(payload)). « GENESIS » en tête de chaîne. Profil de canonicalisation FGN-Canon-v1 : RFC 8785 JCS + clés ASCII uniquement + montants/taux exclusivement entiers (ADR-014, ADR-024).

### 5.2 Deux identifiants

number (FG-YYYY-NNNNNN) : séquentiel légal OHADA Article 23. certification_id (GN-{NIF8}-{YYYY}-{HASH6}) : vérification publique, non-séquentiel.

### 5.3 Clé déléguée

La clé racine signe un certificat de délégation (organization_id, channel, public_key, plafonds). Registre émetteur offline : vérification à la date d'émission — une révocation n'invalide jamais rétroactivement une facture signée quand la clé était valide.

### 5.4 Immutabilité post-émission

Une facture issued ne change plus — seul le statut évolue via des événements append-only. Toute correction passe par un avoir (credit_note).

---

## 6. Money Layer — orchestrateur, commission, paiement

### 6.1 Orchestrateur multi-provider — Djomy primary, Moneroo fallback (ADR-072/073)

Interface PaymentProvider unique pour 4 providers cibles : djomy, moneroo, orange_direct, mtn_direct. Djomy couvre Orange Money Guinée et MTN MoMo Guinée en direct (frais 1% annoncés, à confirmer). Moneroo reste fallback pour cartes internationales et bascule automatique sur timeout Djomy (circuit breaker hard 10s, retry x2 côté Moneroo). Idempotency_key = invoiceId + ':' + provider. Latence p95 visée < 180 ms. Objectif : no vendor lock-in — risque associé R-13.

### 6.2 Commission Money — structure (ADR-074, révise ADR-067)

Grille à 5 paliers avec double taux (affiché / cible négociation) et cap différencié : Freemium 2,5%/2,0% cap 50k, Starter 2,0%/1,5% cap 50k, Pro 1,5%/1,0% cap 75k, Enterprise 1,2%/1,0% cap 100k, Custom volume 1,0%/0,8% floor cap 150k. Total payeur = commission affichée + 1% gateway Djomy. Le commerçant reçoit toujours le montant certifié intégral (ADR-059/074). Projection M18 à 10k organisations : Money net 1 660M GNF/mois (+66% vs 999M sous l'ancienne grille), revenu total 2 080M GNF/mois ≈ 241k USD.

### 6.3 Anti-fuite commission

Tout encaissement non-cash transite par un lien de paiement hébergé (ADR-060). L'API POST /payments rejette method ∉ {cash, bank_transfer} en mode manuel (ADR-061). Détection comportementale (G3) pour les patterns de contournement.

### 6.4 Paiement partiel

Machine à états monotone : issued → partially_paid → paid. Chaque paiement partiel génère un nouveau lien pour le amount_due restant. Cash et lien mixables. Commission captée uniquement sur la partie non-cash.

### 6.5 Régimes fiscaux

normal_tva (>1Md GNF, TVA 18%), tpu (<150M GNF, 5% CA, aucune TVA), normal_sans_tva (150M-1Md, pas de TVA), non_assujetti_association (exonéré par nature, hors MVP). Seuils en paramètre config.

### 6.6 Proforma, devis, annulation

document_type (invoice/proforma/quote). Proforma accepte arrhes uniquement. Devis n'accepte aucun paiement. Conversion crée une NOUVELLE facture draft. Annulation (voided) réservée aux factures sans aucun paiement.

---

## 7. Écosystème cabinet/CGA — professional_practice

Le cabinet comptable, le gestionnaire ou le CGA sont des entités de premier niveau (professional_practice), pas des utilisateurs avec des memberships individuelles (ADR-068, étendu par ADR-078 pour le CGA). Le mandat (practice → organization) remplace la membership pour l'accès multi-org professionnel (ADR-069).

### 7.1 Mandat vs membership

Le mandat est accordé au cabinet/CGA (entité), pas à un individu. Quand un collaborateur quitte, tous ses accès sont révoqués d'un coup.

### 7.2 Dashboard multi-organisation

Vue transversale sur toutes les organisations mandatées. Switch <1s sans rechargement. Isolation RLS : SET app.current_practice.

### 7.3 Revenue share

Le cabinet ou le CGA touche 10% (paramètre config) de la commission facture.gn générée par ses clients mandatés. Calcul quotidien, crédit mensuel, plafond 5 000 GNF/mois/client. Encaissable via payment_link_payout (Djomy Payout, fallback Moneroo) ou déductible de l'abonnement Partner.

### 7.4 Partenaires institutionnels hors mandat — APIP, FODIP, 3AE

APIP (Agence de Promotion des Investissements Privés) : webhook d'acquisition à la création d'entreprise, auto-création organisation via POST /v1/partners/apip/company-created (ADR-077), authentification API key + HMAC-SHA256 (ADR-082). FODIP et 3AE : conventions externes hors plateforme, dashboard lecture seule, codes promo — aucune intégration technique.

---

## 8. B2G — validation administrative, accès, et financement

Chaîne à trois niveaux (ADR-080). Niveau 1 (optionnel) : service technique bénéficiaire, lien à usage unique sans compte, confirme le service fait — non requis pour is_financeable(). Niveau 2 (obligatoire, fait générateur, entre en V1) : DAF / chef de service dépense, authentifié via public_buyer_account, rôle public_buyer_validator (V2 pour le rôle RBAC lui-même, mais le portail de lecture+validation entre en V1). Sa validation de liquidation déclenche invoice.validated_by_administration = true, tracée par l'événement liquidation_validated. Niveau 3 (V2+, post-agrément PDP) : intégration SIGFIP, non construite.

### 8.1 Accès PME — Option 6 USSD et parcours PWA (ADR-086)

Menu *620# option 6 « Commande Publique » : 6.1 émission d'une facture B2G (référence marché optionnelle + montant, saisie condensée), 6.2 consultation du statut de validation DAF. Authentification identique aux options 1-5 (ADR-044/046) — aucun mécanisme de sécurité spécifique à un système tiers, et pour cause : aucun lien cryptographique numéro↔identité n'existe côté facture.gn (incompatible avec ADR-026, clé par organisation/canal, et ADR-087, multi-numéros par utilisateur). Le même parcours existe en PWA, en version complète — choix du rail de financement inclus (§8.3) — l'USSD porte la version condensée, jamais la seule voie d'accès.

### 8.2 TELEMO — relais déclaratif, sans intégration technique (ADR-090)

TELEMO (plateforme nationale de dématérialisation des marchés publics, lancée 22/05/2026, coopération Guinée-Rwanda) précède facture.gn dans le cycle : attribution du marché côté TELEMO, facturation/paiement côté facture.gn — jamais de chevauchement. `INVOICE.reference_marche` (nullable) permet à la PME de recopier manuellement sa référence d'attribution. Aucune vérification automatique, aucune API TELEMO consommée à ce jour — aucun accès confirmé, malgré l'existence probable d'une API côté TELEMO. Le champ est conçu pour accueillir une vérification automatique future, fondée sur le rapprochement NIF organisation ↔ NIF attributaire — jamais sur le numéro de téléphone. En son absence, la cohérence est vérifiée humainement par le DAF au moment de la validation de liquidation. Le nom de l'option reste « Commande Publique » sans mention de TELEMO ; seul le libellé du champ de saisie (« Référence marché TELEMO ») nomme la plateforme.

### 8.3 Financement — deux rails coexistants (ADR-088)

Une facture B2G validée (liquidation DAF) ouvre deux chemins de paiement, toujours disponibles en parallèle, jamais l'un au détriment de l'autre :

- **Rail A — financement** : un `FINANCIAL_PARTNER` (banque ou MFI) avance le montant immédiatement après validation DAF, sans attendre le Trésor. Disbursement via Djomy Payout (Mobile Money) ou virement bancaire, au choix de la PME. Le Trésor rembourse ensuite la banque — jamais la PME, déjà payée — par cession de créance, mécanisme juridique externe que facture.gn ne voit jamais.
- **Rail B — attente directe** : la PME attend le virement du Trésor sans financement (`bank_transfer`, marquage manuel, 0% commission, ADR-052/061).

Le choix du rail se fait après la validation DAF, jamais avant — c'est elle qui rend la facture finançable (`is_financeable()`, ADR-031). Frais de disbursement (`payout_fee_djomy_bps`) portés par la banque sur le Rail A, jamais déduits de ce que la PME reçoit (ADR-089). Anti-double financement : la seule présence de `INVOICE.financed_by_partner_id` bloque une seconde avance sur la même facture. Partenaires initiaux : Ecobank, UBA (banques), COFINA, Akiba Finance (MFI).

Exclusion volontaire et durable : le contrôleur financier, l'ordonnancement et le comptable public (Trésor/DGTCP) restent hors périmètre facture.gn, internes à SIGFIP. Le paiement effectif de l'État est détecté passivement par rapprochement bancaire (ADR-052), jamais par intégration active — cohérent avec le positionnement « intermédiaire privé certifié, jamais un registre d'État » et le risque R-02 (modèle El Fatoora).

---

## 9. Sécurité

### 9.1 Récupération de compte

Backup admin obligatoire à l'onboarding. Récupération via support + recovery_pending, vérification NIF + téléphone (ADR-042).

### 9.2 Révocation et sous-clés (V2)

Révocation en ligne ne touche jamais rétroactivement les sous-clés déjà provisionnées (ADR-043).

### 9.3 Fenêtre de gel post-reset PIN

Notification SMS systématique, bascule 24-48h vers T0.

### 9.4 Break-glass

Activation temporaire (2 admins + OTP + motif), session 1h max (ADR-012).

---

## 10. Conformité

Protection des données : Loi L/2016/037/AN, ANSSI Guinée. LBC/FT : Loi L/2021/024/AN — aucun seuil monétaire minimal, détection comportementale (ADR-032). Conformité comptable : OHADA/SYSCOHADA, séquence sans trou Article 23, export FEC. Agrément PDP : Q3 2027 visé, produit autonome sans agrément.

---

## 11. Idempotence & synchronisation offline

Idempotence stricte sur toute mutation de paiement (Idempotency-Key, UUID v4, TTL 24h) — étendue à la création de facture via USSD et aux webhooks partenaires. CRDT : LWW par champ sauf montants (append-only) et statut (monotone).

---

## 12. Exigences non-fonctionnelles

| Catégorie | Exigence | Mesure |
|---|---|---|
| Performance | API P95 Conakry | < 200 ms |
| Performance | Émission facture | < 2 s |
| Performance | Émission USSD | < 90 s |
| Performance | Switch organisation (cabinet/CGA) | < 1 s |
| Performance | Génération lien de paiement | < 3 s |
| Performance | Latence orchestrateur (p95) | < 180 ms (ADR-073) |
| Disponibilité | Mensuelle | 99,9% |
| Offline | Autonomie PWA | 48h |
| Sécurité | Signature/transport/stockage | Ed25519, TLS 1.3, AES-256 |
| Scalabilité | Organisations / factures | 10 000 orgs, 1M factures/mois |
| i18n | Vocal multilingue | Pular/malinké/soussou (V1) |
| Accessibilité | WCAG | 2.1 AA |

---

## 13. Phasage MVP / V1 / V2

### 13.1 MVP (M1-3, 50+ pilotes)

Trust Layer complet. Tous moyens de paiement (cash, orchestrateur Djomy/Moneroo, virement). Proforma/devis/avoir/annulation/paiement partiel. Régime fiscal dès J1. Offline 48h. RBAC 9 rôles. Export FEC. USSD *620#. Multi-numéros par utilisateur (USER_PHONE, ADR-087). Vérification NIF+eTax. Dashboard cabinet/CGA (consultation + FEC + switch). Mandats.

### 13.2 V1 (M4-9)

USSD étendu, vocal multilingue. Facturation récurrente + rappels. MTN MoMo/Wave via l'orchestrateur. RBAC 19 rôles. Portail cabinet/CGA complet. Gestionnaire d'activité. Badge Ordre OCAECG. UBL 2.1 + extension crypto. Webhook APIP, modèle Partner (FODIP/3AE). Portail admin publique — validation DAF Niveau 2 (B2G). Option 6 Commande Publique — émission facture B2G + consultation statut liquidation (USSD et PWA, ADR-086).

### 13.3 V2 (M10-18)

Capital Layer complet. Scoring segmenté. Factoring B2G, is_financeable() opérationnel. Portail bancaire + API. Financement B2G — Rail A/B, FINANCIAL_PARTNER, anti-double financement (ADR-088/089). Sous-clé terrain offline. Agrément PDP.

---

## 14. Limites assumées

La certification protège une facture émise, pas une vente jamais déclarée. Un export UBL sans bloc d'extension crypto = document commercial, pas preuve légale. Le registre émetteur doit être déposé chez un tiers durable. Le champ multi-devise est un affichage, jamais une capacité de facturation multi-devise réelle. La validation administrative B2G (Niveau 2) constate la liquidation, jamais le paiement effectif de l'État.

---

## 15. Veille stratégique

NimbaPay (BCRG/GuiM, Mojaloop, lancé 22/07/2026) : infrastructure nationale de paiement instantané, couche interbancaire — complémentaire, pas concurrent. Orange Money participant, MTN MoMo absent. Intégration prématurée — surveillance active (R-12).

TELEMO (marchés publics, lancé 22/05/2026) : partenaire amont du cycle B2G, pas un système intégré techniquement (ADR-090). Surveillance active (R-15) sur deux axes : ouverture éventuelle d'une API publique, élargissement de périmètre vers la facturation/le paiement (auquel cas une réévaluation R-02-like serait nécessaire).

---

*facture.gn — DAT — Document confidentiel — 8 août 2026*
