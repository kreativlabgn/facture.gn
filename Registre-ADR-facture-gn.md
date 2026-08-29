# facture.gn — Registre ADR

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Architecture Decision Records ADR-001 à ADR-094

| Champ | Valeur |
|---|---|
| Date | 8 août 2026 |
| Statut | Consolidé — ADR-001 à ADR-094, intègre paiement, partenaires institutionnels/B2G, grille des offres, multi-numéros, Commande Publique, financement B2G, TELEMO, lutte anti-fuite commission et amorçage Capital |
| Audience | Équipe technique, Tech Lead/Architecte |
| Documents liés | DAT · PRD · Backlog · ERD · Spec USSD · Risques-RACI · CdC · Grille-Offres |

> 94 décisions d'architecture verrouillées — le DAT y réfère par tag sans répéter le contexte. Toute nouvelle décision reçoit le numéro suivant, jamais de renumérotation rétroactive.

---

## Partie 1 — Architecture fondamentale (ADR-001 à ADR-020)

**ADR-001 — Services séparés par bounded context**
Décision : 4 bounded contexts (Trust, Money, Capital, Platform), contrats API formalisés (OpenAPI + Pact).
Conséquences : Isolation des pannes ; coût de coordination inter-services.

**ADR-002 — PostgreSQL 16 + TimescaleDB, RLS multi-tenant**
Décision : RLS par organisation plutôt que base par tenant ou filtrage applicatif.
Conséquences : SET app.current_company obligatoire à chaque requête.

**ADR-003 — Cert-Engine isolé, écrit en Rust**
Décision : Service séparé Rust — 12k signatures/s vs 800 en Node.
Conséquences : Compétence Rust requise ; vecteurs de test partagés avec la librairie JS.

**ADR-004 — Money Mesh isolé du reste de l'API**
Décision : Service Node séparé, pannes confinées.
Conséquences : Résilience ; réconciliation inter-services (webhook + polling).

**ADR-005 — Infrastructure OVH Gravelines (3 AZ) + edge Conakry**
Décision : Kubernetes multi-AZ + réplique Conakry, frontend Vercel.
Conséquences : Bascule dégradée possible en cas de coupure OVH.

**ADR-006 — Meilisearch plutôt qu'Elasticsearch**
Décision : 10x plus léger, suffisant au volume visé.
Conséquences : Réévaluation si volume dépasse les projections.

**ADR-007 — ConfigCat pour les feature flags**
Décision : Flag jamais permanent (expiration max 90 jours).
Conséquences : Rollout par pourcentage ; discipline anti-accumulation.

**ADR-008 — HashiCorp Vault pour les secrets**
Décision : Vault HA, unseal Shamir 3-de-5, rotation automatique.
Conséquences : Accès loggé par identité de service.

**ADR-009 — RBAC à rôles techniques + presets métier**
Statut : révisé par ADR-027.
Décision : 17 rôles techniques, 2 presets (freelancer, hotel_receptionist).
Conséquences : 54 permissions qui en découlent (étendu depuis par ADR-070/DAT §3.4 à 61-62).

**ADR-010 — Numérotation séquentielle FG-YYYY-NNNNNN**
Statut : révisé par ADR-023.
Décision : Préfixe FG-, 6 chiffres, par organisation, RAZ annuelle.
Conséquences : Conforme OHADA Article 23.

**ADR-011 — JWT RS256 + Ed25519 en double couche**
Décision : JWT pour authentification, Ed25519 (X-Facture-Signature) pour toute mutation.
Conséquences : Double vérification à chaque écriture.

**ADR-012 — Permissions break-glass jamais permanentes**
Décision : Activation temporaire (2 admins + OTP + motif), session 1h max.
Conséquences : Notification CTO+CISO+audit.

**ADR-013 — MinIO avec object lock WORM 10 ans**
Décision : WORM + object lock pour PDF/A et preuves.
Conséquences : Coût stockage prévisible sur 10 ans.

**ADR-014 — Montants en centimes GNF (integer)**
Décision : Tous les montants en integer, jamais de float.
Conséquences : Étendu par ADR-024 aux taux.

**ADR-015 — Event sourcing append-only pour invoice_event**
Décision : Append-only, source de vérité audit.
Conséquences : 22 types d'événements catalogués (DAT §4.1) — étendus V2 par ADR-081 (liquidation_validated, service_fait_confirmed).

**ADR-016 — Idempotency-Key obligatoire sur toute mutation de paiement**
Décision : Header UUID v4, TTL 24h, cache Redis.
Conséquences : Étendu à la création de facture via USSD, et aux webhooks partenaires entrants (ADR-082).

**ADR-017 — Ed25519 plutôt que RSA ou ECDSA**
Décision : Signatures 64 octets, clés 32 octets, vérification rapide.
Conséquences : Écosystème plus restreint qu'ECDSA.

**ADR-018 — SHA-256 pour le chaînage, pas SHA-3**
Décision : Standard industriel, performance, compatibilité HSM.

**ADR-019 — PDF/A-3 pour l'archivage long terme**
Décision : Factures embarquent XML structuré + signature.

**ADR-020 — OpenTelemetry natif, pas de vendor lock-in**
Décision : Correlation IDs bout en bout.
Conséquences : Migration vers un autre backend possible. Quatre environnements dev/staging/sandbox/prod ; sandbox partenaires (DGI, opérateurs Mobile Money, webhooks APIP) étendu par ADR-082.

---

## Partie 2 — Consolidation (ADR-021 à ADR-054)

**ADR-021 — Chaînage dans le payload signé, pas comme métadonnée**
Décision : chain.prev est un champ du contenu signé.
Conséquences : Intégrité vérifiable offline.

**ADR-022 — Profil de canonicalisation FGN-Canon-v1**
Décision : RFC 8785 JCS + clés ASCII + montants/taux entiers.

**ADR-023 — Double identifiant number + certification_id**
Décision : number = légal séquentiel, certification_id = vérification non-séquentielle.
Conséquences : Les deux ne se confondent jamais.

**ADR-024 — Taux en basis points (integer), pas en décimal**
Décision : Cohérent avec ADR-014.

**ADR-025 — Registre émetteur : vérification à la date d'émission**
Décision : Clé racine côté appelant, pas côté snapshot.
Conséquences : Révocation jamais rétroactive.

**ADR-026 — Clé déléguée par organisation et par canal**
Décision : Certificat de délégation signé par la clé racine.
Conséquences : Révocation par canal possible.

**ADR-027 — RBAC déployé en trois paliers**
Décision : MVP 9 (révisé par ADR-070) → V1 18+ → V2 20+.
Conséquences : Aucun rôle V2 codé avant son cas d'usage. Comptage révisé par ADR-098 : V1 passe à 19 (public_buyer_validator avancé), V2 reste à 20.

**ADR-028 — platform_compliance_officer en rôle transverse**
Décision : 2FA obligatoire, vision cross-organisation.
Conséquences : 19e→20e rôle, 55e→62e permission.

**ADR-029 — Mécanisme générique cross_tenant_grant**
Décision : Table générique plutôt que cas particuliers empilés.

**ADR-030 — Positionnement B2G : rend finançable, ne force jamais le paiement**
Décision : Clause contractuelle à porter dans tout support B2G.
Conséquences : Précisé et borné à la liquidation (jamais l'ordonnancement ni le paiement effectif) par ADR-080.

**ADR-031 — Règle composite unique is_financeable()**
Décision : Fonction versionnée, toute modification est un ADR.
Conséquences : Le composant validated_by_administration est défini précisément par ADR-080.

**ADR-032 — Détection LBC/FT comportementale, sans seuil minimal**
Décision : Patterns : montants ronds, boucles client/montant, écart MM vs facturé.
Conséquences : Revue humaine systématique.

**ADR-033 — Régime fiscal à quatre valeurs, jamais un taux TVA plat**
Décision : normal_tva, tpu, normal_sans_tva, non_assujetti_association. Champ obligatoire.
Conséquences : Étendu par ADR-057.

**ADR-034 — Arrhes/acompte distingués, traitement TVA scindé**
Décision : deposit_type, cancellation_indemnity vs no_show_forfeited, refund_multiplier 2x.

**ADR-035 — Inscription : NIF et eTax conjoints**
Décision : Les deux exigés (mais optionnels à l'inscription — B4).
Conséquences : Étendu par ADR-077 : etax_number reste nullable pour toute organisation créée via un canal partenaire (webhook), avec traçabilité de la source via registration_source.

**ADR-036 — dgi_verification_status gate uniquement le Capital Layer**
Décision : Usage de base jamais bloqué.

**ADR-037 — Multi-succursale, numérotation au niveau organisation**
Décision : branch sous organization, number jamais par branche.

**ADR-038 — Dédoublonnage : jamais de fusion automatique**
Décision : possible_duplicate_of, résolution manuelle.

**ADR-039 — Crédit client, relevé jamais certifié**
Décision : credit_limit/running_balance (calculé sur amount_due). account_statement sans hash.

**ADR-040 — Avoir au niveau ligne (credit_note_line)**
Décision : Référence invoice_line_id, réajustement stock par branche.

**ADR-041 — dispute_status orthogonal au cycle de vie paiement**
Décision : Champ distinct de status, événements append-only.

**ADR-042 — Récupération de compte owner**
Décision : Backup admin obligatoire, support + recovery_pending.

**ADR-043 — Révocation non-rétroactive pour sous-clés terrain (V2)**
Décision : Bloque nouvelles émissions, flague existantes.

**ADR-044 — Session USSD toujours connectée**
Décision : Signature serveur immédiate, idempotence stricte étendue.

**ADR-045 — Inscription toujours assistée, jamais en USSD pur**
Décision : Agent/PWA, coïncide avec la génération de clé racine.

**ADR-046 — Code compte + PIN pour téléphone emprunté**
Décision : Hypothèse « un numéro = une identité » fausse.

**ADR-047 — Code court avec vérification de collision**
Décision : Vérification d'unicité à la génération, index dédié.

**ADR-048 — Raccourcis USSD restreints, jamais de client identifié en clair**
Décision : Limités à l'émission anonyme et la vérification.

**ADR-049 — Découplage palier commercial / velocity_tier**
Décision : Palier commercial gouverne l'accès aux fonctionnalités (jamais un nombre de factures), velocity_tier gouverne le montant. Jamais dépendant de DGI.
Conséquences : Corrigé le 26/07/2026 : la caractérisation initiale du palier commercial par le « nombre » de factures est remplacée par « fonctionnalités », pour rester cohérent avec la décision modèle économique du 25/07 (H1) qui a retiré tout plafond de volume.

**ADR-050 — Table velocity_tier à 4 fenêtres, croisée opérateurs + régime fiscal**
Décision : T0-T3, calés sur Orange Money identifié/non-identifié.
Conséquences : Source unique dans le DAT.

**ADR-051 — Canal vocal priorisé sur la traduction USSD texte**
Décision : 68% analphabétisme, engagement V1 explicite.

**ADR-052 — Virement bancaire ajouté, chèque exclu**
Décision : bank_transfer rapprochement asynchrone. Chèque hors flux certifié.

**ADR-053 — Export UBL 2.1 avec bloc d'extension crypto**
Décision : Sans le bloc, étiqueté « non probant ».

**ADR-054 — Facture anonyme plafonnée T0/acte**
Décision : 500 000 GNF, indépendant du palier.

---

## Partie 3 — Compléments (ADR-055 à ADR-057)

**ADR-055 — Multi-devise : champs informatifs, jamais dans le payload signé**
Décision : reference_currency, reference_amount, fx_rate, fx_rate_date. Aucune valeur contractuelle.

**ADR-056 — Récurrence : régime jamais figé sur le template**
Décision : Chaque instance recalcule le régime au moment de la génération. Flag de revue si regime_change.
Conséquences : Principe « alerte, jamais un mur silencieux ».

**ADR-057 — Formes juridiques : legal_form distinct de regime_fiscal, 4e valeur associative**
Décision : organization.legal_form (commercial/association). non_assujetti_association. Hors MVP.

---

## Partie 4 — Décisions du 25/07/2026 (ADR-058 à ADR-071)

### Modèle économique et paiement

**ADR-058 — Paramètres réglementaires/tarifaires en table de config versionnée**
Décision : Seuils régime fiscal, taux de commission, TTL liens, seuils de preuve — jamais en dur dans le code. Chaque modification est un événement auditable.
Conséquences : Correction future = mise à jour de config, pas un refactor. Table CONFIG_PARAMETER étendue le 26/07 pour couvrir la grille tarifaire à 5 paliers (voir ADR-074) et les frais gateway Djomy.

**ADR-059 — Commission Money portée par le payeur, montant certifié jamais pollué**
Décision : Le montant certifié (invoice.total_ttc) ne contient jamais les frais plateforme. Nouveau champ payment.amount_collected = total_ttc + platform_fee.
Conséquences : Assiette fiscale et FEC propres.

**ADR-060 — Paiement non-cash via lien de paiement hébergé, orchestré multi-provider**
Décision : Tout encaissement non-cash transite par un lien de paiement hébergé. Commission et frais captés atomiquement. payment.method = payment_link pour les paiements par lien.
Conséquences : Marchand ne reçoit jamais de MM direct pour une facture facture.gn. Révisé par ADR-072/073 : le provider par défaut du lien est désormais résolu par l'orchestrateur (Djomy primary, Moneroo fallback), et non plus une exclusivité Moneroo — voir Partie 5.

**ADR-061 — Marquage manuel restreint au cash et au virement**
Décision : POST /payments rejette method ∉ {cash, bank_transfer} en mode manuel. Détection comportementale (G3) pour les contournements.
Conséquences : Anti-fuite commission.

**ADR-062 — Paiement partiel autorisé, statut partially_paid**
Décision : Machine à états : issued → partially_paid → paid. N paiements successifs. Nouveau lien de paiement pour le amount_due restant. Cash et lien mixables.
Conséquences : running_balance client sur amount_due. Export FEC = N écritures par facture.

**ADR-063 — Remboursement (refund) distinct de l'avoir comptable**
Décision : credit_note = document comptable. refund = mouvement d'argent. Un refund exige toujours un credit_note préalable. Modes : cash, payment_link_payout (Djomy Payout, fallback Moneroo), virement, crédit en compte.
Conséquences : Le champ schéma refund.method est déjà provider-agnostique (payment_link_payout) ; seule la prose narrative des autres documents nommait Moneroo à tort — corrigé le 26/07 suite à l'inversion primary/fallback (ADR-072).

**ADR-064 — Proforma et devis comme sous-types de draft**
Décision : document_type (invoice/proforma/quote). Proforma accepte arrhes uniquement. Devis n'accepte aucun paiement. Conversion crée une NOUVELLE facture, recalcule le régime. /issue rejeté si document_type ≠ invoice.

**ADR-065 — Annulation par voided, réservée aux factures sans paiement**
Décision : voided = état terminal si et seulement si aucun payment n'existe. Contenu signé intact, numéro FG- jamais réutilisé. Si paiement existe → avoir obligatoire.
Conséquences : Exclue du North Star (ni numérateur ni dénominateur).

**ADR-066 — Expiration du lien de paiement, pas de la facture**
Décision : Facture ne « expire » jamais (prescription OHADA 5 ans). Lien de paiement TTL 30j (config). Régénérable à la demande. Factures >90j sans action = tag dormant.
Conséquences : Dormantes incluses dans le dénominateur du taux d'encaissement (incitation à relancer).

**ADR-067 — Commission Money : structure, affichage, capture**
Décision : 3 composantes agrégées en platform_fee (gateway + facture.gn). Affichage payeur : montant facture + frais + total. payment.platform_fee_amount et gateway_fee_amount jamais dans le payload signé.
Conséquences : La grille à taux unique par palier (Freemium 1,5%/Starter 1,2%/Pro 1,0%, cap uniforme 50 000 GNF) initialement décrite ici est remplacée par une grille à 5 paliers et double taux (affiché/cible négo), cap différencié par palier. Voir Partie 5.
Statut : révisé par ADR-074.

### Écosystème cabinet

**ADR-068 — Cabinet/gestionnaire = entité professional_practice, pas un utilisateur avec des memberships**
Décision : Entité de premier niveau parallèle à organization. Types : cabinet_comptable, gestionnaire, fiduciaire. Dashboard propre, facturation propre, collaborateurs.
Conséquences : Mandat remplace membership pour l'accès multi-org professionnel. Étendu par ADR-078 : 4e type cga pour les Centres de Gestion Agréés.

**ADR-069 — Mandat (practice → organization) remplace membership individuelle**
Décision : Accordé à l'entité cabinet, pas à un individu. Révocation par cabinet = tous les collaborateurs perdent l'accès. Turnover géré proprement. Acceptation explicite obligatoire (PWA ou *620# option 5.3 + PIN).
Conséquences : Audit enrichi : « user X du cabinet/practice Y a consulté ».

**ADR-070 — accountant_external avancé au MVP, business_manager reste V1**
Décision : 12 pilotes Mamadou nécessitent accountant_external au MVP. Scope MVP réduit (consultation + FEC + switch). Fonctionnalités avancées en V1. RBAC MVP passe de 7 à 9 rôles.

**ADR-071 — Revenue share cabinet : commission d'apport sur les transactions des clients mandatés**
Décision : 10% de la commission facture.gn (paramètre config). Plafond 5 000 GNF/mois/client. Calcul quotidien, crédit mensuel. Encaissable via payment_link_payout (Djomy Payout, fallback Moneroo) ou déductible de l'abonnement.
Conséquences : Alignement d'intérêt cabinet ↔ facture.gn ↔ PME. S'applique identiquement au 4e type practice cga (ADR-078).

---

## Partie 5 — Refonte Payment Orchestration du 26/07/2026 (ADR-072 à ADR-076)

Cette partie documente la refonte actée le 26/07/2026 (board d'exécution 4 semaines, fichiers ChefOrchestre.jsx et PaymentOrchestration.jsx), qui inverse le provider par défaut du lien de paiement et refond la grille tarifaire. Elle amende ADR-060 et ADR-067 sans les annuler.

**ADR-072 — Djomy.africa devient le provider primary, Moneroo rétrogradé en fallback**
Décision : Djomy couvre Orange Money Guinée + MTN MoMo Guinée en direct (frais 1% annoncés, à confirmer), endpoints /confirm_otp + verify_payment + webhook. Moneroo reste fallback pour cartes internationales et bascule automatique sur timeout Djomy.
Conséquences : CinetPay disparaît complètement de l'architecture. Toute mention documentaire antérieure de CinetPay (T-04, CdC §4.3) est une trace stale à corriger, pas une décision active.

**ADR-073 — Orchestrateur maison — interface PaymentProvider unique**
Décision : Interface commune (createPaymentLink / verifyTransaction / handleWebhook) pour 4 providers cibles : djomy, moneroo, orange_direct, mtn_direct. Registry.resolve avec circuit breaker timeout hard 10s → bascule auto vers Moneroo. Retry x2 côté Moneroo. Idempotency_key = invoiceId + ':' + provider. Latence p95 visée < 180 ms. Objectif explicite : no vendor lock-in.
Conséquences : payment.provider_sub_method (couche métier/payeur : orange_money/mtn_momo/card/wave) reste distinct de payment_provider_attempts.provider (couche orchestrateur technique : djomy/moneroo/orange_direct/mtn_direct) — deux abstractions différentes, jamais confondues.

**ADR-074 — Total payeur = commission affichée + frais gateway, montant certifié toujours intégral**
Décision : Nouvelle grille tarifaire à 5 paliers avec double taux (com. affichée / cible négo) et cap différencié : Freemium 2,5%/2,0% cap 50k, Starter 2,0%/1,5% cap 50k, Pro 1,5%/1,0% cap 75k, Enterprise 1,2%/1,0% cap 100k, Custom volume 1,0%/0,8% floor cap 150k. Total payeur = commission affichée + 1% gateway Djomy. Le commerçant reçoit toujours le montant certifié intégral.
Conséquences : Révise ADR-067 (grille à 3 paliers/taux unique/cap uniforme, devenue obsolète). Projection M18 à 10k organisations : Money net 1 660M GNF/mois (+66% vs 999M sous l'ancienne grille), revenu total 2 080M GNF/mois ≈ 241k USD.

**ADR-075 — payment_webhooks.processed_at comme clé d'idempotence**
Décision : Un webhook reçu deux fois n'est traité qu'une seule fois — déduplication sur (provider, provider_ref, processed_at).
Conséquences : Nouvelle table payment_webhooks (id, provider, provider_ref, payload jsonb, normalized_status, processed_at, signature_valid).

**ADR-076 — Nouvelle table payment_provider_attempts — traçabilité par tentative**
Décision : id, invoice_id, provider enum(djomy/moneroo/orange_direct/mtn_direct), status enum(pending/success/failed/timeout), provider_ref, amount_gnf, fee_gateway, fee_platform, created_at, settled_at.
Conséquences : Ajoute 2 entités au modèle de données (base 25/07 = 21). Permet l'audit complet de chaque tentative de paiement, y compris les bascules primary→fallback. Total à ce stade (25/07 + cet ADR + ADR-078) : 24 entités — voir Partie 8 (ADR-087, ADR-089) pour les ajouts ultérieurs, et l'ERD pour le décompte consolidé final (27).

**Risque associé** : R-13 — Vendor lock-in Djomy : mitigé par le fallback Moneroo prouvé (test de bascule sur timeout 10s, board d'exécution Chantier 2). Formalisé dans le Registre des Risques.

---

## Partie 6 — Partenaires institutionnels, positionnement DGI, B2G (ADR-077 à ADR-082)

Décisions actées le 26/07/2026, en session stratégique distincte de la refonte paiement. Couvrent l'intégration des partenaires institutionnels (APIP, CGA, FODIP, 3AE), le repositionnement narratif de la DGI, et la mécanique de validation administrative du B2G.

### Partenaires institutionnels et acquisition

**ADR-077 — Inscription via canal partenaire : registration_source ajouté**
Décision : Nouveau champ organization.registration_source (enum organic / apip / cga_referral / fodip / partner_3ae) trace le canal d'acquisition d'une organisation. Nouveau endpoint pattern POST /v1/partners/{partner_type}/{event} (ex. /v1/partners/apip/company-created) pour l'auto-création d'organisations depuis un webhook partenaire (APIP — Agence de Promotion des Investissements Privés — transmet RCCM+NIF à la création d'entreprise).
Conséquences : N'amende PAS ADR-035 sur le fond : etax_number est déjà nullable à l'inscription pour tout canal (self-service ou assisté, cf. B4). La contribution réelle est le mécanisme de création via webhook externe et la traçabilité de la source — pas une nouvelle règle de nullabilité.

**ADR-078 — Modèle Partner générique — CGA intégré via professional_practice, 4e type dédié**
Décision : Table professional_practice.type étendue à une 4e valeur : cga (Centre de Gestion Agréé — créé par décret du 17 février 2017, sous tutelle DGI, mécanisme d'abattement fiscal -50%/-25% sur 3 ans). Un CGA suit exactement le même mécanisme que les cabinets comptables : mandate, dashboard multi-organisation, revenue share (ADR-071, taux et plafond identiques). FODIP et 3AE restent hors plateforme — convention externe, dashboard lecture seule (Metabase), codes promo. Aucune intégration technique pour ces deux derniers.
Conséquences : CGA entre en V1, au même titre que le cabinet comptable, en s'appuyant sur le portail cabinet déjà prévu — même code, même flux d'acceptation de mandat (PWA ou *620# option 5.3+PIN), aucun nouvel écran USSD requis.

### Positionnement DGI

**ADR-079 — Positionnement DGI : bénéficiaire structurel, jamais opérateur**
Décision : DGI est nommée explicitement dans la cartographie institutionnelle et le go-to-market, au même titre que APIP/CGA/FODIP/3AE. Nature de la relation : bénéficiaire structurel — l'assiette fiscale s'élargit mécaniquement à chaque nouvelle PME qui émet sa première facture certifiée, comme effet secondaire de la certification, jamais comme mission première.
Conséquences : Clause symétrique à ADR-030 (B2G) : facture.gn élargit l'assiette fiscale, ne se substitue jamais au contrôle fiscal ni au rôle de la DGI. Préserve le positionnement « intermédiaire privé certifié, jamais un registre officiel ».

### B2G — validation administrative

**ADR-080 — B2G : chaîne de validation administrative à trois niveaux**
Décision : Niveau 1 (optionnel, non requis pour is_financeable()) : service technique bénéficiaire confirme le service fait via lien à usage unique, sans compte. Niveau 2 (obligatoire, fait générateur, V1 — repositionné depuis V2 après confirmation que le portail admin publique lecture+validation est déjà scope V1) : DAF / chef de service dépense de l'administration cliente, authentifié via public_buyer_account, rôle public_buyer_validator. Sa validation de liquidation déclenche invoice.validated_by_administration = true. Niveau 3 (V2+, post-agrément PDP) : intégration SIGFIP — non construite, risque de positionnement façon El Fatoora (R-02).
Conséquences : validated_by_administration est défini précisément comme « liquidation validée par le DAF », jamais « paiement reçu du Trésor ». Le contrôleur financier, l'ordonnancement et le comptable public (Trésor/DGTCP) restent explicitement hors périmètre facture.gn — internes à SIGFIP. Le paiement effectif est détecté passivement par rapprochement bancaire (ADR-052). Nouveau persona « DAF / Administration cliente », distinct du persona DGI.

**ADR-081 — Nouveaux types d'événements invoice_event pour le B2G — liquidation_validated et service_fait_confirmed**
Décision : Deux nouveaux types V2 dans le catalogue invoice_event : liquidation_validated (fait générateur de validated_by_administration, porte l'identité du public_buyer_validator signataire) et service_fait_confirmed (Niveau 1, optionnel, non construit tant que le Niveau 1 reste facultatif).
Conséquences : Catalogue invoice_event passe de 22 à 24 types en V2. Ces deux événements sont indépendants de validation_revoked (qui couvre la révocation d'une sous-clé cryptographique terrain, Trust Layer — un domaine entièrement différent, sans lien de filiation avec le B2G). **Révisé par ADR-098** : liquidation_validated avancé en V1 (catalogue MVP/V1 22→23) pour rester cohérent avec le Niveau 2 déjà positionné V1 par ADR-080 ; seul service_fait_confirmed reste V2.

**ADR-082 — Authentification des webhooks partenaires entrants : API key + HMAC-SHA256**
Décision : Chaque partenaire enregistré (APIP en premier lieu) reçoit une API key dédiée (header X-Partner-Key) et un secret partagé pour signer le corps en HMAC-SHA256 (header X-Partner-Signature). Vérification obligatoire à la réception. Rate limiting par partenaire. Idempotence par Idempotency-Key (ADR-016).
Conséquences : Distinct de l'authentification utilisateur (JWT + Ed25519, ADR-011) — un partenaire institutionnel n'est pas un utilisateur facture.gn. Clés stockées dans Vault (ADR-008), rotation annuelle minimum. Sandbox partenaire (ADR-020) étendu pour inclure les webhooks entrants.

**Risque associé** : R-14 — Adoption administration cliente insuffisante pour la validation B2G Niveau 2 : faible, latent, V2 — formalisé dans le Registre des Risques.

---

## Partie 7 — Grille des Offres et fonctionnalités par palier (ADR-083 à ADR-085)

Décisions actées le 26/07/2026, en session de travail sur la matrice de fonctionnalités par palier commercial (Grille des Offres). Couvrent la gestion sensible des clients, la marge produit, et le support client par SLA.

**ADR-083 — Permissions dédiées pour les opérations sensibles sur CUSTOMER**
Décision : Trois nouvelles permissions, scope V1 : customer:merge_duplicate, customer:manage_credit_limit, customer:flag_public_entity (déclarée en V1 mais inerte jusqu'en V2, faute de public_buyer_account). Réservées admin/owner. Toute augmentation de credit_limit au-delà d'un seuil (paramètre config, ADR-058) déclenche une validation obligatoire par le rôle approver — jamais une décision unilatérale d'un admin seul.
Conséquences : Catalogue de permissions passe de 61 (MVP) à 64 en V1 sur ce seul ADR (+3). Le rôle approver — jusqu'ici défini sans cas d'usage concret au-delà d'un intitulé générique — reçoit ici son premier contenu fonctionnel réel. Rien ne change au MVP : création/modification de client reste ouverte à cashier/field_agent/admin/owner sans restriction nouvelle.

**ADR-084 — Coût produit et marge, avec snapshot historique**
Décision : PRODUCT.cost_price (bigint, nullable, centimes GNF) — nullable pour ne jamais bloquer la création d'un produit (cohérent avec ADR-056, « jamais un mur silencieux »). INVOICE_LINE.cost_price_at_time (bigint, nullable) — snapshot copié depuis PRODUCT.cost_price au moment de la facturation, jamais recalculé rétroactivement (même pattern que tax_rate_bps). Nouvelle permission analytics:view_margin, réservée owner/admin/business_manager, scope V1. Marge affichée en GNF et en pourcentage.
Conséquences : Sans le snapshot, un changement de cost_price déformerait rétroactivement tous les rapports de marge passés. Catalogue de permissions V1 passe de 64 à 65 (+1, cette entrée). La donnée de coût reste invisible à cashier/field_agent même dans une organisation dont le palier commercial ouvre les analytics avancés — gate de permission plus restrictif que le gate de palier.

**ADR-085 — SLA support par sévérité, staffing dédié**
Décision : SLA structuré par sévérité (Critique/Majeur/Mineur) croisée avec le palier commercial — engagement sur le temps de réponse, jamais sur le temps de résolution. Seuils déclarés en paramètre config versionné (ADR-058), ajustables sans refactoring. Canal WhatsApp Business API pour le Critique en Enterprise/Custom — réutilise l'intégration déjà en place (rappels, liens de paiement), aucune nouvelle brique technique. Deux postes « Chargé de support client » ouverts, rattachés à la Directrice Générale — pas à un squad technique.
Conséquences : L'accès aux organisations clientes en contexte support s'appuie sur le mécanisme déjà existant cross_tenant_grant (ADR-029) en mode session temporaire — pas un nouveau mécanisme d'accès à inventer. Risque G-06 (SLA promis sans staffing) formalisé et résolu dans le même mouvement par l'ouverture des deux postes.

**Récapitulatif catalogue de permissions** : 61 (MVP) → 65 (V1 — ADR-083 +3, ADR-084 +1) → 66 (V2 — +1, compliance:manage_declarations, ADR-028).

---

## Partie 8 — Multi-numéros, Commande Publique, financement B2G, TELEMO (ADR-086 à ADR-090)

Décisions actées lors des travaux sur l'accès multi-canal, l'Option 6 USSD « Commande Publique », le financement des créances B2G, et le positionnement de TELEMO (marchés publics, lancé 22/05/2026). Ce bloc referme le B2G ouvert par ADR-080/081.

**ADR-086 — Option 6 USSD : Commande Publique, scope réduit sans intégration Trésor temps réel**
Décision : Menu *620# option 6 : 6.1 émission d'une facture B2G (référence marché optionnelle + montant, saisie condensée pour économiser la session), 6.2 consultation du statut de validation DAF (liquidation, Niveau 2, ADR-080). Accès à l'option via l'authentification facture.gn standard (téléphone reconnu → PIN, ou code compte + PIN — ADR-044/046), aucun mécanisme de sécurité spécifique à un système tiers. Explicitement exclu : consultation des visas Trésor, tout signal temps réel côté Trésor — reste Niveau 3 (ADR-080), non construit, pour ne pas rouvrir R-02. Le même parcours est accessible en PWA, en version complète (choix du rail de financement inclus, voir ADR-088) — l'USSD porte la version condensée, jamais la seule voie d'accès.
Conséquences : Aucune donnée Trésor n'est jamais consultée par facture.gn, quel que soit le canal. Le nom de l'option reste « Commande Publique » sans référence à un tiers dans le menu — voir ADR-090 pour la nuance sur le champ de référence marché.

**ADR-087 — Multi-numéros par utilisateur (USER_PHONE) — MVP**
Décision : Nouvelle table `USER_PHONE` (user_id, msisdn, is_primary, verified_at) remplace le champ `phone` unique sur USER. L'authentification USSD vérifie contre cette table — un même utilisateur reconnu sur plusieurs numéros, sans ressaisir de code compte à chaque changement de téléphone. Scope **MVP**, pas V1.
Conséquences : Aucun impact sur la clé cryptographique, toujours par organisation et par canal (ADR-026) — jamais par numéro de téléphone. Aucun impact sur le RBAC. C'est précisément ce découplage qui rend incompatible toute proposition de sécurité USSD fondée sur un lien figé numéro↔identité (voir ADR-090).

**ADR-088 — Financement B2G : deux rails coexistants, jamais un remplacement de l'autre**
Décision : Une facture B2G validée (liquidation DAF, Niveau 2) ouvre deux chemins de paiement, disponibles en permanence côté PME, jamais l'un au détriment de l'autre :
- **Rail A — financement** : une banque ou MFI partenaire (`FINANCIAL_PARTNER`, voir ADR-089) avance le montant immédiatement après validation DAF — pas d'attente du Trésor. Disbursement via Djomy Payout (Mobile Money) ou virement bancaire, au choix de la PME. Le Trésor rembourse ensuite la banque, jamais la PME (déjà payée), par cession de créance — mécanisme juridique externe à facture.gn, qui ne voit jamais ce flux.
- **Rail B — attente directe** : la PME n'utilise aucun financement, attend le virement du Trésor directement (`bank_transfer`, marquage manuel, 0% commission — cohérent ADR-052/061).
Le choix du rail se fait après la validation DAF, jamais avant — c'est cette validation qui rend la facture finançable (`is_financeable()`, ADR-031).
Conséquences : Premiers partenaires financiers identifiés : Ecobank (banque), UBA (banque), COFINA (MFI), Akiba Finance (MFI, agréée BCRG, inclusion financière PME/femmes). La détection passive du paiement Trésor (ADR-052) reste inchangée sur le Rail B uniquement.

**ADR-089 — Entité FINANCIAL_PARTNER, paramètre payout_fee_djomy_bps, anti-double financement**
Décision : Nouvelle entité `FINANCIAL_PARTNER` (id, name, type enum(banque, mfi), api_key, status) — V2, structurellement distincte de `PARTNER` (institutionnel léger : apip/fodip/partner_3ae), parce qu'une banque a des besoins différents (API dédiée, KYC, conditions de financement). Nouveau champ `INVOICE.financed_by_partner_id` (nullable FK → FINANCIAL_PARTNER) et `INVOICE.financed_at` (nullable timestamp) — la seule présence du premier bloque un second financement de la même facture. Nouveau paramètre de config `payout_fee_djomy_bps` (ADR-058), applicable uniformément aux trois cas d'usage qui utilisaient déjà Djomy Payout sans qu'un frais n'ait jamais été formalisé : refund (ADR-063), revenue share cabinet (ADR-071), avance B2G (ADR-088). Porté par la banque sur le Rail A — jamais déduit de ce que la PME reçoit.
Conséquences : Concrétise pour la première fois le concept « anti-double nantissement » déjà mentionné (Backlog, CdC, DAT, Grille-Offres) sans mécanisme défini jusqu'ici. Nouveau type d'événement `financing_disbursed` (V2) au catalogue invoice_event — 24 → 25 types.

**ADR-090 — TELEMO : partenaire amont, relais déclaratif conçu pour compatibilité API future**
Décision : TELEMO (plateforme nationale de dématérialisation des marchés publics, lancée 22/05/2026, coopération Guinée-Rwanda) est positionné en amont du cycle facture.gn — attribution du marché, jamais facturation ni paiement. Même statut cartographique que APIP/CGA/FODIP/3AE. Nouveau champ `INVOICE.reference_marche` (nullable) : la PME y recopie manuellement sa référence d'attribution TELEMO au moment de l'émission B2G. Aucune vérification automatique aujourd'hui, aucune API TELEMO consommée — aucun accès confirmé à ce jour, malgré l'existence probable d'une API côté TELEMO. Le champ est conçu pour accueillir une vérification automatique le jour où l'accès est confirmé, fondée sur le rapprochement **NIF organisation facture.gn ↔ NIF attributaire TELEMO** — jamais sur le numéro de téléphone, incompatible avec ADR-026 (clé par organisation/canal) et ADR-087 (multi-numéros par utilisateur). En l'absence de vérification automatique, la cohérence entre la facture et le dossier TELEMO est vérifiée humainement par le DAF au moment de la validation de liquidation.
Conséquences : Le nom de l'option USSD/PWA reste « Commande Publique », sans mention de TELEMO — seul le libellé du champ (« Référence marché TELEMO ») nomme la plateforme, pour rester descriptif sans suggérer un partenariat non confirmé. Nouveau risque R-15 (veille TELEMO) formalisé dans le Registre des Risques : surveille l'évolution de l'accès API et tout élargissement de périmètre de TELEMO vers la facturation/le paiement.

---

## Partie 9 — Lutte anti-fuite commission et amorçage Capital (ADR-091 à ADR-094)

Décisions actées le 8 août 2026, en session de travail sur le risque de fuite de commission (B-08, Risques-RACI) et son lien avec la qualité de l'historique Capital. S'appuie sur un tour d'horizon de précédents externes (UPI/Inde, Wave, M-Shwari/MYbank, littérature marketplace sur la désintermédiation) discuté et arbitré verbalement avant formalisation.

**ADR-091 — Échelle de conséquences pour la détection comportementale G3**
Décision : G3 (détection comportementale de contournement, mentionnée depuis ADR-061 sans mécanisme de suite) reçoit une échelle progressive à quatre niveaux, jamais punitive au premier signal : Niveau 1 — nudge informatif in-app, ton neutre, jamais accusatoire ; Niveau 2 — preuve renforcée (seuil photo/GPS abaissé spécifiquement pour l'organisation concernée, sous cash_proof_threshold_gnf) ; Niveau 3 — revue manuelle par Squad Money, jamais automatique ; Niveau 4 — restriction ciblée sur les fonctionnalités premium uniquement, jamais sur le compte Freemium de base. Signaux déclencheurs : chute brutale du ratio non-cash d'une organisation déjà convertie, écart statistique vs moyenne sectorielle/quartier, récurrence de montants juste sous le seuil de preuve. Moteur de détection mutualisé avec ADR-032 (LBC/FT) — même infrastructure comportementale, deux jeux de règles distincts. Aucun seuil numérique de « taux de fuite acceptable » figé à ce stade — calibrage prévu après les données des 50+ pilotes.
Conséquences : Comble le vide laissé ouvert depuis ADR-061 — B-08 (Risques-RACI) passe de « mitigé par conception » à « mitigé, échelle de réponse formalisée ». Les règles statistiques précises (seuils, fenêtres de comparaison) restent à spécifier techniquement par Squad Money/Data sur données réelles, pas en dur dans cet ADR.

**ADR-092 — Fenêtre d'accueil Freemium à tarif Starter**
Décision : Deux nouveaux paramètres de configuration versionnés (ADR-058), commission_freemium_onboarding_displayed_bps et commission_freemium_onboarding_target_bps, valorisés au niveau Starter (200/150 bps, soit 2,0 %/1,5 %) plutôt qu'au tarif Freemium standard (250/200 bps). Fenêtre active pendant 90 jours ou 20 factures certifiées réglées par lien de paiement — le premier des deux seuils atteints déclenche la bascule automatique et irréversible vers le tarif Freemium standard. La grille à 5 paliers (ADR-074) et ses caps ne sont pas modifiés — il s'agit d'une surcharge temporaire au niveau organisation, jamais d'une réouverture de la grille.
Conséquences : Impact financier marginal sur la projection M18 (1 660M GNF) — seules les organisations en phase d'essai sont concernées, pas le cœur du volume établi. Nouvelle règle de vigilance ajoutée au périmètre G3 (ADR-091) : création d'organisations multiples par un même propriétaire pour reboucler artificiellement la fenêtre d'accueil.

**ADR-093 — Score de confiance transactionnelle avancé au MVP**
Décision : Le ratio paiements vérifiés (règlement par lien) / total des paiements, jusqu'ici envisagé comme brique V2 du Capital Layer, est avancé au MVP (Sprint 1-4) sous forme d'un indicateur affiché au dashboard de l'organisation. Calcul dérivé de payment.method sur les données déjà captées — aucune nouvelle brique d'infrastructure, aucun nouveau champ de schéma. Affichage strictement informatif et interne à l'organisation : jamais un gate de fonctionnalité, jamais exposé à un tiers externe au MVP — le portail bancaire (V2, Grille-Offres §6) reste le seul point d'exposition externe prévu, non construit ici.
Conséquences : L'historique du ratio s'accumule dès la mise en production plutôt que d'être reconstitué rétroactivement en V2 — aligné sur le constat que la vitesse de constitution de l'historique importe davantage que sa seule promesse. Aucun impact sur le périmètre ni le calendrier MVP : lecture seule sur des données déjà existantes.

**ADR-094 — Ligne informative sur la finalité de la commission à l'écran de paiement**
Décision : Une ligne est ajoutée sous le détail des frais de l'écran de paiement (Checkout, story C19/ADR-067), explicitant ce que finance la commission — certification de la transaction et constitution d'un historique reconnu par les partenaires financiers. Formulation exacte à finaliser avec MOB (UI/UX), sous contrainte de la charte graphique (Vert Validé et Rouge Alerte réservés aux états de validation, jamais décoratifs ici). Aucune comparaison nominative à un concurrent (Wave, Orange Money, MTN MoMo) dans le produit.
Conséquences : Ajustement mineur des critères d'acceptation de C19 (Backlog). Aucun impact technique — contenu textuel statique ou paramétrable, aucune nouvelle donnée.

**Hors registre — Chantier Capital, amorçage** : une prise de contact précoce Sponsor/DG avec Akiba Finance (MFI déjà identifiée, ADR-088/089), sans LOI ni échéance contraignante, pour faire valider en amont les signaux réellement pertinents pour leur souscription avant que le format du score de confiance (ADR-093) ne soit figé plus avant. Ce n'est pas une décision d'architecture — suivi comme item de chantier, pas comme ADR. Rattachement documentaire (Chef-Orchestre ou Risques-RACI) à trancher séparément.

---

## Partie 10 — Architecture de navigation applicative (ADR-095)

Décision actée le 14 août 2026, en réponse au chantier n°1 de l'Audit RBAC × Dashboards (aucun système de navigation/menu n'existait dans aucune source — Design System comme maquette — bloquant le dessin de tout écran, maquetté ou non).

**ADR-095 — Six shells applicatifs distincts, navigation gatée par permission jamais par rôle**

Décision : Le produit se découpe en **six shells de navigation indépendants**, chacun avec sa propre IA — pas de shell générique partagé entre portails externes (écarté : la variété réelle des permissions et du vocabulaire entre cabinet/CGA, DAF et client aurait forcé soit une sur-généralisation de l'IA, soit des branches conditionnelles qui auraient fait perdre l'intérêt de la mutualisation).

1. **App principale PME (back-office)** — owner, admin, accountant_internal, cashier, field_agent, delivery_driver, business_manager, inventory_manager, approver, auditor, viewer, developer_api. Bottom tab bar mobile-first (profil PME majoritairement smartphone Android, cohérent offline-first) : **Accueil · Factures · [+ Émettre, CTA central surélevé] · Clients · Plus**. Le tiroir « Plus » contient Produits & Stock (inventory_manager V1), Paiements & Encaissements, Analytics marge (business_manager/owner/admin — jamais cashier/field_agent, cf. ADR-070/084), Commande Publique (si organisation éligible B2G, ADR-086), Approbations (approver, badge de notification sur credit_limit hors seuil, ADR-083), Équipe & Rôles (owner/admin), Journal d'audit (auditor V1), Développeur/API (developer_api V1), Paramètres organisation, Support. Chaque item du tiroir est gaté par permission individuelle, jamais par un switch générique « niveau de rôle » — un cashier et un business_manager sur le même compte voient un tiroir structurellement différent. field_agent et delivery_driver reçoivent une variante allégée du même shell (Accueil + Émettre en assisted_session uniquement, pas de tiroir) plutôt qu'un shell séparé.

2. **Portail Cabinet/CGA** — accountant_external et practice_admin, désormais explicitement distingués (tranche l'incohérence relevée dans l'audit sur l'écran s6 existant) : Portefeuille de mandats (liste + switch d'organisation <1s, ADR-069) → Factures & Export FEC (lecture seule, scope MVP ADR-070) sont visibles par les deux rôles ; l'onglet Cabinet (gestion collaborateurs, revenue share, `practice:invite_member`/`practice:view_billing`/`practice:view_revenue_share`, DAT §RBAC) n'est visible que par practice_admin.

3. **Portail Administration publique (DAF)** — public_buyer_validator. Deux écrans seulement : Factures reçues (liste filtrable par statut de liquidation, encours total en tête de page) et Détail facture avec une action unique possible, « Valider la liquidation » — jamais une action de paiement (contrainte UX critique déjà actée, Parcours-UX). Pas de tiroir, pas de switch multi-organisation.

4. **Portail client_portal** — Mes factures (toutes organisations émettrices confondues, filtrable), Détail facture (statut, lien de paiement si impayée, certification_id vérifiable), Mon profil. Lecture et paiement uniquement, aucune action d'émission.

5. **Portail tax_controller_readonly** (renommé depuis dgi_readonly, ADR-104) — proposé à titre d'hypothèse de travail, non definitif : lecture seule d'une organisation donnée (Factures + Export FEC), distinct de la vue nationale agrégée qui reste un produit de la persona institutionnelle « DGI » (PRD, lecture agrégée) hors RBAC utilisateur. La distinction, non résolue au moment de cette décision, est confirmée par ADR-104 — seule une structure minimale est posée ici pour débloquer une éventuelle maquette, à valider avec le propriétaire produit avant construction.

6. **Console interne facture.gn (Ops)** — jamais exposée à une PME cliente (cohérent Grille-Offres:67). Deux profils dans le même shell desktop : **support** (Recherche organisation → activation `cross_tenant_grant` temporaire avec bandeau d'accès délégué visible et compte à rebours, ADR-085/029 → File de tickets par sévérité, Parcours-UX §SLA) et **sysadmin** (Recherche/gestion organisations, Feature flags, Rôles système, Logs d'audit globaux — supervision infra type Grafana/Prometheus restant externe, jamais réimplémentée ici). Périmètre sysadmin posé sur une seule mention existante (Grille-Offres:67) — structure proposée à valider par Squad Platform avant construction, pas une certitude actée au même niveau que les shells 1 à 4.

Conséquences : Comble le chantier n°1 de l'Audit RBAC × Dashboards — plus aucun écran, maquetté ou non, ne peut être dessiné sans shell d'accueil défini. Le Design System (§8, à ajouter) doit désormais spécifier les composants Bottom Tab Bar, Drawer/tiroir, et Liste-à-switch-d'organisation (portails 2-5). Rôles restant sans contenu fonctionnel propre (inventory_manager, auditor, sysadmin — cf. audit, catégorie « non spécifié ») ont désormais un emplacement de navigation mais toujours aucune spécification du contenu qui s'y affiche : ce chantier définit où, pas quoi. Les shells 3 à 6 restent, comme le shell 1, soumis à la contradiction de calendrier non résolue sur `public_buyer_validator` (V1 selon ADR-080/PRD, V2 selon DAT §3.3/Backlog section K).

---

## Partie 11 — Identité client_portal (ADR-096)

Décision actée le 14 août 2026, en réponse au chantier n°1 de l'Audit RBAC × Dashboards (client_portal : rôle MVP fondateur, zéro spécification malgré la priorité maximale).

**ADR-096 — client_portal : identité auto-résolue par téléphone vérifié, jamais un accès délégué classique**

Décision : `client_portal` n'est **pas** un rôle assigné par un owner/admin au sein d'une organisation comme les huit autres rôles MVP — c'est une **identité transverse auto-résolue par numéro de téléphone vérifié**. Un client vérifie son numéro via USER_PHONE (même flux PIN que le canal USSD, ADR-087) ; le portail résout alors automatiquement, à la volée, l'ensemble des `CUSTOMER.phone` correspondant à un de ses msisdn vérifiés, à travers **toutes** les organisations facture.gn — aucune action d'un owner/admin n'est requise pour « accorder » l'accès. F10 (« Inviter un client non encore inscrit », Backlog §F) reste un mécanisme complémentaire de découverte proactive par SMS, jamais une condition d'accès : un client peut toujours s'auto-vérifier sans avoir été invité.

Contenu exposé, par organisation où une correspondance existe : liste de factures (statut, montant, lien de paiement si impayée, `certification_id` vérifiable), et le `running_balance`/`credit_limit` propres à ce `CUSTOMER` vis-à-vis de cette organisation — jamais les autres clients de l'organisation, jamais une organisation où son numéro ne correspond à aucun `CUSTOMER.phone`. Un `CUSTOMER.phone` nul (vente anonyme/cash) n'apparaît dans aucun portail client_portal — comportement attendu, pas un défaut à corriger.

Aucun nouveau champ de schéma requis — résolution `CUSTOMER.phone = USER_PHONE.msisdn` au moment de la requête, cohérent avec la philosophie déjà appliquée à l'indicateur de confiance (ADR-093) : dérivé de données déjà captées, aucune nouvelle brique.

Conséquences : DAT §3.5 (Accès délégué) doit désormais distinguer deux familles distinctes — accès délégué classique (mandat/assisted_session/viewer, révocable par un tiers) vs identité auto-résolue (client_portal, que l'organisation ne peut jamais révoquer — seul le client contrôle son propre numéro vérifié). Aucun impact sur l'ERD ni sur le catalogue de permissions (61 au MVP, DAT §3.4 inchangé) : le scope est structurel, pas déclaratif, donc aucune permission dédiée n'est nécessaire. Risque résiduel accepté et non mitigé davantage à ce stade : un client qui change de numéro sans avoir d'abord ajouté l'ancien comme secondaire (ADR-087) perd l'accès à son historique, rattaché à un `CUSTOMER.phone` que plus personne ne peut revendiquer.

---

## Partie 12 — Les cinq rôles V1 fantômes (ADR-097)

Décision actée le 14 août 2026, en réponse au chantier n°4 de l'Audit RBAC × Dashboards : `inventory_manager`, `auditor`, `dgi_readonly`, `sysadmin`, `developer_api` se limitaient chacun à un nom cité dans une énumération et une case cochée dans la grille tarifaire — zéro responsabilité, zéro permission. Minimum posé ici : une phrase de responsabilité et, quand nécessaire, une permission par rôle — pas des écrans (chantier de maquette distinct, non traité ici).

**ADR-097 — Périmètre minimal des cinq rôles V1 sans contenu fonctionnel**

Décision :

- **inventory_manager** — gère les niveaux de stock par succursale (`PRODUCT_STOCK.stock_qty`, déjà en base) : réception, ajustement de quantité, consultation des seuils bas. Ne voit jamais `cost_price`/marge (territoire business_manager, ADR-070/084) sauf cumul explicite de rôle. Un stock insuffisant n'a jamais bloqué l'émission d'une facture — même philosophie que `cost_price` qui « n'a jamais bloqué la création d'un produit » (ERD). Nouvelle permission `inventory:manage_stock` (V1).
- **auditor** — lecture seule du journal d'audit de l'organisation : `invoice_event` (append-only, ADR-015) et historique des changements de permissions/rôles. Aucune action de modification, aucune exception. Nouvelle permission `audit:view_log` (V1).
- **dgi_readonly** — rôle d'invitation optionnelle par une organisation pour donner à un contrôleur fiscal local un accès lecture seule à ses propres factures + export FEC. Distinct de la persona institutionnelle « DGI » nationale (PRD §4.3, lecture agrégée hors RBAC utilisateur) — cette distinction reste à valider avec le propriétaire produit, non tranchée par le présent ADR. Composé uniquement de permissions déjà existantes en lecture seule (`invoice:view`, `export:fec`) — aucune permission nouvelle, aucune capacité d'écriture.
- **sysadmin** — rôle interne facture.gn, jamais assignable par une PME cliente (Grille-Offres:67), donc **hors du catalogue de permissions client** (§3.4 DAT) : administration de `CONFIG_PARAMETER` (paramètres versionnés — commissions, seuils), gestion des `PARTNER`/`PARTNER_LINK` (onboarding APIP/FODIP/3AE/CGA), supervision technique via liens externes (Grafana/Prometheus, jamais réimplémentés dans le produit). Opère exclusivement via la console interne (shell 6, ADR-095).
- **developer_api** — gestion en self-service des clés API personnelles/organisation (génération, révocation, rotation) et consultation des logs d'appels. Nouvelle permission `api:manage_keys` (V1). Le webhook sortant marchand (notifier un système tiers qu'une facture est payée) reste hors périmètre — gap distinct, non résolu ici.

Conséquences : Catalogue de permissions V1 (DAT §3.4) passe de 65 à 68 (+`inventory:manage_stock`, +`audit:view_log`, +`api:manage_keys`) ; la 66e permission V2 (`compliance:manage_declarations`) devient la 69e. `sysadmin` reste explicitement exclu de ce catalogue — c'est un rôle d'exploitation, pas un rôle client. Ce chantier définit *une* responsabilité minimale par rôle, pas un flux complet : aucun de ces cinq rôles n'a encore d'écran ni de story Backlog détaillée — seul le strict nécessaire pour sortir de la catégorie « nom vide » de l'audit.

---

## Partie 13 — Repositionnement V1 de public_buyer_validator (ADR-098)

Décision actée le 14 août 2026, en réponse au point de vigilance « à surveiller » de l'Audit RBAC × Dashboards : ADR-080 affirmait le Niveau 2 (validation DAF) « repositionné depuis V2 » vers V1, mais son fait générateur technique — l'événement `liquidation_validated` (ADR-081) — restait catalogué V2, tout comme le rôle `public_buyer_validator` lui-même (ADR-027/028, DAT §3.2/3.3, PRD:157, en-tête Backlog section K). Une fonctionnalité ne peut pas être V1 si la brique dont elle dépend ne l'est pas.

**ADR-098 — `liquidation_validated` et `public_buyer_validator` avancés en V1, tranchant le conflit ADR-080/ADR-081**

Décision : L'intention d'ADR-080 est confirmée et rendue cohérente — le rôle `public_buyer_validator` et l'événement `invoice_event.liquidation_validated` qui le fait fonctionner passent tous deux en **V1**, alignés sur le calendrier de positionnement institutionnel précoce face au risque R-02 (modèle centralisé façon El Fatoora). `service_fait_confirmed` (Niveau 1, optionnel) et `financing_disbursed` (ADR-089, rails de financement) restent V2 — seul le strict nécessaire au Niveau 2 avance.

Conséquences, propagées dans les documents vivants (pas dans les ADR déjà actés, qui restent tels quels avec ce renvoi) :
- Catalogue `invoice_event` : 22→**23** types confirmés au catalogue MVP/V1 (dont `liquidation_validated`) ; V2 n'ajoute plus que 2 types (`service_fait_confirmed`, `financing_disbursed`), total inchangé à 25.
- RBAC : V1 passe de 18 à **19 rôles** (ajout de `public_buyer_validator`) ; V2 reste à 20 rôles cumulés (n'ajoute plus que `platform_compliance_officer`).
- Shell 3 (portail Administration publique/DAF, ADR-095) redevient un chantier V1 à part entière, pas une anticipation V2 — cohérent avec sa présence déjà actée dans DAT §8 et le calendrier Brief-DGI.
- Aucun changement sur le Rail A/B de financement B2G (ADR-088), qui reste V2 : la validation DAF avancée ne rend pas `is_financeable()` opérationnel plus tôt, elle ouvre seulement le champ `validated_by_administration` dès V1, sans consommateur de ce champ avant V2.

---

## Partie 14 — Dernier rôle vide : accountant_internal (ADR-099)

Décision actée le 14 août 2026, clôturant l'Audit RBAC × Dashboards : sur 19 rôles/personas MVP+V1, `accountant_internal` restait le seul sans une seule phrase de responsabilité — cité uniquement dans les énumérations de rôles (PRD:157, DAT §3.1, Registre-ADR:127).

**ADR-099 — accountant_internal : comptable salarié, lecture complète et clôture, aucune gouvernance**

Décision : `accountant_internal` est le comptable **salarié de l'organisation** (contexte OHADA/SYSCOHADA), distinct du cabinet externe mandaté (`accountant_external`, accès par mandat révocable, scope MVP consultation+FEC, ADR-070) et distinct d'`admin` (qui détient la gouvernance). Composé exclusivement de permissions déjà existantes — **aucune permission nouvelle**, catalogue MVP reste à 61 (DAT §3.4) :
- Lecture complète : toutes les factures, tous les clients (y compris `running_balance`/`credit_limit`), marge produit (`analytics:view_margin` — jamais accessible à cashier/field_agent, ADR-084, mais accessible ici).
- Clôture : émission d'avoirs (`credit_note`), export FEC.
- Aucune permission de gouvernance : ni gestion d'équipe/RBAC, ni break-glass (DAT §9.4), ni `customer:merge_duplicate`/`customer:manage_credit_limit` — réservées admin/owner par ADR-083, non étendues à ce rôle.
- Aucune émission de facture primaire : reste le terrain de cashier/field_agent/owner/admin. Le rôle est orienté contrôle et clôture, pas vente.

Conséquences : Les 19 rôles/personas MVP+V1 ont désormais tous au moins une responsabilité définie — l'Audit RBAC × Dashboards ne compte plus aucun « nom vide ». Aucun écran ni story Backlog détaillée n'existe pour autant : comme pour ADR-097, ce chantier pose le *quoi minimal*, pas le *comment*.

---

## Partie 15 — Grossiste fournisseur : nouveau persona, extension FINANCIAL_PARTNER (ADR-100)

Décision actée le 14 août 2026, sur un cas d'usage terrain remonté hors audit : un grossiste impose à ses 300 boutiques clientes l'usage de facture.gn (« plus de livraison sans facture.gn ») pour les commandes, les paiements, et conditionne l'octroi de crédit à l'usage de la plateforme. Deux relations distinctes se superposent, à ne jamais confondre.

**ADR-100 — Grossiste fournisseur : relation commerciale existante + nouvelle relation de crédit privé (FINANCIAL_PARTNER étendu)**

Décision :

1. **Relation commerciale (grossiste → boutique comme CUSTOMER)** — intégralement couverte par l'existant, aucun changement de schéma : le grossiste facture ses boutiques via `CUSTOMER`, le crédit commercial classique (délai de paiement fournisseur) via `credit_limit`/`running_balance` (ADR-039/062), le pilotage via l'analytics « clients à risque » déjà spécifié (Grille-Offres §, business_manager V1). Seul gap réel : l'**import en masse de clients** (300 en une fois) — aujourd'hui un seul à la fois (cashier/field_agent/admin) — chantier distinct, non résolu ici.
2. **Chaque boutique comme organisation autonome** — déjà pleinement supporté sans changement : rien n'empêche aujourd'hui qu'une organisation facture.gn soit simultanément cliente (`CUSTOMER`) d'une autre organisation et émettrice de ses propres factures certifiées à ses propres clients finaux.
3. **Relation de crédit privé (grossiste → boutique comme partenaire financier)** — nouvelle : `FINANCIAL_PARTNER.type` (ADR-089, aujourd'hui `banque`/`mfi`) reçoit une troisième valeur, `fournisseur_crediteur`, pour les acteurs commerciaux non agréés qui octroient des avances à leurs boutiques clientes sur la base du score de confiance transactionnelle (ADR-093) de la boutique — jamais sur son propre `credit_limit` interne au grossiste, qui reste un objet distinct (délai de paiement fournisseur ≠ avance de trésorerie). Condition stricte : la boutique doit accorder un **mandat explicite** (réutilise le mécanisme déjà existant, ADR-069) avant que son score de confiance — par défaut interne et non exposé (ADR-093) — devienne visible du grossiste. Aucune visibilité automatique du seul fait de la relation commerciale.
4. **Le mécanisme de l'avance lui-même n'est pas conçu ici.** Le financement existant (ADR-088/089, Rail A) est un mécanisme ponctuel *par facture* (`INVOICE.financed_by_partner_id`) — une ligne de crédit renouvelable basée sur un score d'organisation est un produit financier différent, sans mécanisme de suivi de principal/tirage/remboursement dans le modèle actuel. Chantier V2 Capital Layer à part entière, non traité ici.
5. **Nouveau risque réglementaire (R-16, Registre des Risques)** — contrairement aux MFI déjà identifiées (Akiba Finance, agréée BCRG), un grossiste n'est pas un établissement de crédit agréé. Faciliter l'octroi de crédit privé à grande échelle par un acteur non agréé pourrait constituer une activité de crédit non réglementée au sens du droit guinéen. **À qualifier avec un conseil juridique avant toute construction du point 3/4** — ce n'est pas tranché par cet ADR, seulement signalé.

Conséquences : ERD (`FINANCIAL_PARTNER.type`) et Grille-Offres/CdC à mettre à jour pour refléter le nouveau persona et le nouveau type de partenaire. Aucun impact sur le MVP — les points 1 et 2 fonctionnent déjà, les points 3 à 5 sont V2 et explicitement non résolus au-delà du positionnement.

---

## Partie 16 — Positionnement marketplace B2B (ADR-101)

Décision actée le 14 août 2026, en cadrage du second volet du cas d'usage grossiste : l'idée d'une marketplace B2B (« le Jumia des Grossistes ») construite sur facture.gn.

**ADR-101 — facture.gn reste infrastructure, jamais opérateur de marketplace**

Décision : facture.gn ne construit ni n'opère de marketplace B2B. Toute marketplace de ce type est un produit distinct — tiers, ou entité structurellement séparée — qui consomme facture.gn comme infrastructure via le modèle `PARTNER`/API déjà éprouvé avec APIP (ADR-077/078/082) : certification (Trust), paiement orchestré (Money), et à terme le score de confiance (Capital, ADR-093), toujours sous mandat explicite comme pour tout `FINANCIAL_PARTNER` (ADR-100). Aucune fonctionnalité de catalogue, de découverte ou de classement de vendeurs construite dans facture.gn elle-même.

Justification : une marketplace prend nécessairement parti — classement, mise en avant, intérêt au volume. La superposer au rôle de tiers de confiance neutre (« jamais un registre ou une autorité d'État », positionnement répété de la DGI au Brief-DGI) créerait un conflit d'intérêt structurel au moment même où facture.gn certifierait des transactions qu'elle aurait elle-même orchestrées commercialement.

Conséquences : Aucun changement de schéma, de roadmap MVP/V1/V2, ni de catalogue de permissions. Ajouté explicitement au hors-périmètre du CdC (§2.4). Si une marketplace B2B voit le jour, elle entre comme n'importe quel partenaire (nouvelle entrée `PARTNER`), jamais comme un chantier interne facture.gn. Le risque d'une future pression à internaliser la marketplace n'est pas ajouté au Registre des Risques faute de pression concrète actuelle — à réévaluer si le sujet revient avec un porteur de projet identifié.

---

## Partie 17 — Adoption de la direction visuelle et maquette consolidée (ADR-102)

Décision actée le 14 août 2026, clôturant le chantier de maquette des 6 shells (ADR-095).

**ADR-102 — Nuit Atlantique/Or de Guinée adoptée définitivement, maquette consolidée en un seul fichier**

Décision : La direction « Nuit Atlantique / Or de Guinée » du Design System (§2), jusqu'ici marquée « proposée, à valider », est **adoptée définitivement** — elle a été exécutée et éprouvée sur les 6 shells de l'ADR-095, pas seulement décrite. `Maquette-facture-gn.html` est réécrit pour devenir la référence consolidée unique : un sélecteur de shell en tête de page, les 6 shells dans un seul fichier, polices embarquées (Space Grotesk/Inter/JetBrains Mono), chaque shell auto-isolé en IIFE pour éviter toute collision de script entre shells lors de la consolidation.

Conséquences : `Design-System-facture-gn.md` passe en v1.1 — palette non plus « à valider » mais validée, §8 Navigation complété avec le pattern sidebar desktop (shell 6, absent de la première rédaction) et le bandeau d'accès délégué. L'ancienne exécution claire (navy/jaune sur fond gris) de la maquette originale (26 juillet 2026) est remplacée — elle ne correspondait qu'à l'app PME et n'avait jamais couvert les 5 autres shells. Les écrans hors périmètre des sessions de maquette (Checkout, Vérification publique, USSD, Commande Publique) restent dans leur exécution d'origine, non retouchés — seuls les 6 shells de l'ADR-095 ont été repris.

---

## Partie 18 — Retour au fond clair, ADR-102 abandonné (ADR-103)

Décision actée le 15 août 2026, un jour après ADR-102 : le sponsor exprime une préférence explicite pour le fond blanc/gris clair et le bleu Nuit Atlantique tel qu'exécuté dans la maquette originale (26 juillet 2026), contre la direction sombre testée la veille.

**ADR-103 — Fond clair adopté définitivement, ADR-102 abandonné**

Décision : La direction sombre (Nuit Atlantique en fond principal) actée par ADR-102 est abandonnée sans ambiguïté, un jour après son adoption. Retour à l'exécution claire d'origine : fond gris clair (`#F5F7F9`), cartes blanches, texte Nuit Atlantique (`#0B1D3A`) — Nuit Atlantique change de rôle, de couleur de fond à couleur de texte. Or de Guinée (`#FBB500`, mesuré) reste inchangé — c'est un fait de marque, pas un choix de thème, contrairement à ce qu'a pu laisser penser sa présence dans les deux directions testées. Les six shells (ADR-095) et leurs artifacts sont retouchés à l'identique sur ce seul point — aucune structure, aucune IA, aucun contenu fonctionnel n'est remis en cause, uniquement la palette.

Conséquences : `Design-System-facture-gn.md` passe en v1.2. Les tokens `--surface` (fond de carte sombre, `#14283F`) et `--text` (blanc cassé, `#F5F3EE`) de l'exécution ADR-102 sortent de la palette applicative active — ils restent documentés dans cet ADR et dans ADR-102 par souci de traçabilité, mais ne doivent plus être réutilisés. `Maquette-facture-gn.html` republié une seconde fois en 24h — la vitesse de ce revirement est elle-même un signal : la couleur de fond est un chantier bon marché à tester puis à défaire, contrairement à l'architecture de navigation (ADR-095) qui n'a pas bougé depuis sa décision. Aucune leçon de gouvernance à en tirer au-delà de ce constat — un désaccord sur une teinte de fond ne mérite pas le même formalisme qu'un désaccord d'architecture.

---

## Partie 19 — dgi_readonly renommé, distinction confirmée (ADR-104)

Décision actée le 17 août 2026, en réponse au point non tranché laissé ouvert par ADR-097 (Partie 12) : la distinction entre le rôle RBAC `dgi_readonly` (invitation par une organisation d'un contrôleur fiscal local, lecture seule de ses propres factures + export FEC) et la persona institutionnelle « DGI » nationale (PRD, lecture agrégée, bénéficiaire structurel, jamais opérateur du produit, ADR-079) est confirmée par le propriétaire produit — ce sont deux mécanismes distincts qui ne se recouvrent pas et coexistent sans conflit.

**ADR-104 — dgi_readonly renommé tax_controller_readonly, distinction avec la persona institutionnelle DGI confirmée**

Décision : La distinction posée par ADR-097 est correcte et conservée telle quelle — un contrôleur fiscal local invité par une PME pour consulter ses propres factures n'a aucun rapport fonctionnel avec la persona institutionnelle DGI (lecture agrégée nationale, jamais un compte, jamais un rôle RBAC, ADR-079). Mais le nom littéral `dgi_readonly` dans le catalogue RBAC entretient une ambiguïté contraire au positionnement non négociable de facture.gn — tiers de confiance privé certifié, **jamais une autorité d'État** (rappelé dans chaque document vivant du projet). Un rôle nommé d'après une administration publique, même cantonné à la lecture seule, peut laisser croire à tort que la DGI opère ou est représentée dans le produit. Le rôle est renommé **`tax_controller_readonly`** — mêmes permissions (`invoice:view`, `export:fec`, aucune écriture), même mécanisme d'invitation par l'organisation, même disponibilité universelle dès Freemium (Grille-Offres). Seul le nom change.

Conséquences : `dgi_readonly` → `tax_controller_readonly` propagé dans les documents vivants — catalogue RBAC V1 (DAT §3.2, PRD §6, Grille-Offres) et description du shell 5 (ADR-095, Partie 10, ci-dessus). ADR-097 n'est pas réécrit — le renvoi se fait depuis cette décision, pas depuis l'ADR déjà acté (même principe qu'ADR-098 vis-à-vis d'ADR-080/081). Aucun changement de permission, de palier ou de catalogue (reste 68 permissions V1, ADR-097) — uniquement un renommage et une confirmation de périmètre. Le shell 5 de la maquette (`Maquette-facture-gn.html`) garde ses ids internes `dgi-*` en l'état pour l'instant — le renommage du rôle métier ne force pas une refonte immédiate de la maquette, qui reste de toute façon qualifiée d'hypothèse de travail (ADR-095, Partie 10).

---

## Partie 20 — customer:flag_public_entity activée en V1 (ADR-105)

Décision actée le 17 août 2026, conséquence directe d'ADR-098 restée non explicitée à l'époque : ADR-083 (Partie 7) avait scopé `customer:flag_public_entity` en V1 mais l'avait déclarée **inerte jusqu'en V2**, faute de `public_buyer_account` — cette dépendance bloquante n'existait qu'en V2 au moment de la décision. ADR-098 a depuis avancé `public_buyer_account`, le rôle `public_buyer_validator` et le portail Niveau 2 (lecture + validation DAF) en V1 (Partie 13). La dépendance qui rendait la permission inerte n'existe donc plus — sans que personne ne l'ait explicitement remarqué jusqu'à la relecture de l'ERD qui a suivi (correction du 17/08).

**ADR-105 — customer:flag_public_entity pleinement active en V1, plus de statut inerte**

Décision : La permission est activée sans restriction dès V1. Sans elle, le portail Niveau 2 déjà V1 (ADR-098, DAT §8) n'aurait structurellement aucune facture à présenter à un DAF : une organisation doit pouvoir marquer un de ses clients comme entité publique (`CUSTOMER.is_public_entity = true`) pour que ses factures entrent dans le circuit de validation. Un portail de réception/validation V1 sans porte d'entrée côté PME émettrice n'aurait aucun sens fonctionnel. Aucune permission nouvelle, aucun changement de palier — uniquement la levée d'une contrainte de dépendance devenue caduque. Réservée admin/owner, comme les deux autres permissions du même lot (`customer:merge_duplicate`, `customer:manage_credit_limit`, ADR-083).

Conséquences : Aucun changement au catalogue de permissions (reste 68 en V1, DAT §3.4 — qui ne portait déjà pas la mention d'inertie, donc rien à corriger de ce côté). ADR-083 n'est pas réécrit — renvoi depuis cette décision, même principe qu'ADR-098/104. Le Backlog reçoit une nouvelle story (F16) : aucune n'existait pour l'action PME de marquer un client comme entité publique — seul le côté DAF (réception + validation de la liquidation, J1/J2) était couvert.

---

## Partie 21 — Révision tarifaire : Starter Plus, Djomy à 1,4 %, Partner Free réduit (ADR-106)

Décision actée le 17 août 2026, sur constat du Sponsor que la grille tarifaire laissait du chiffre d'affaires sur la table à trois endroits : un saut Starter→Pro sans palier intermédiaire pour les succursales, un Partner Free trop généreux pour inciter à l'upgrade, et une hausse de coût Djomy jamais répercutée dans la grille.

**ADR-106 — Palier Starter Plus, frais Djomy relevés à 1,4 % absorbés en interne, Partner Free ramené à 5 organisations avec graduation**

Décision, en quatre volets :

1. **Nouveau palier Starter Plus** (250 000 GNF/mois, entre Starter à 100 000 et Pro à 500 000) — 5 succursales, 7 collaborateurs, mais **aucune fonctionnalité de sophistication** (pas de RBAC avancé, analytics toujours Basique, pas d'API). Sépare pour la première fois l'axe échelle de l'axe sophistication, jusqu'ici confondus dans une seule progression linéaire (Grille-Offres §2.1).
2. **Prix relevés sur les paliers existants** : Starter 75k→100k, Pro 250k→500k, Enterprise (« sur devis »)→750k, Custom (« négocié »)→1,5M — Enterprise et Custom passent d'un prix uniquement sur devis à un prix catalogue publié, même si la négociation individuelle reste possible via la commission cible.
3. **Frais gateway Djomy relevés de 1 % à 1,4 %** (traité en taux flat par simplification — la vraie grille Djomy est dégressive mais non modélisée ici). La hausse est **intégralement absorbée par la commission facture.gn**, jamais répercutée sur le total payeur : chaque palier existant garde exactement le total payeur de la grille du 26/07 (ADR-074) — 3,5/3,0/2,5/2,2/2,0 %. Le levier de mitigation du volume Freemium illimité (§1.1, non remis en cause) est le taux d'encaissement déjà existant comme North Star metric (§1.3), activé pour la première fois comme nudge Freemium spécifique : seuil >60 % de paiements cash sur 30 jours glissants, action = relance vers le lien de paiement, jamais un plafond.
4. **Partner Free ramené de 10 à 5 organisations mandatées**, avec trois signaux de graduation vers Partner Starter plutôt qu'un seul mur dur : nudge à la 4ᵉ organisation, mur dur à la 6ᵉ, et un signal de valeur indépendant du compte (revenue share cumulé > 20 000 GNF/mois) qui attrape les cabinets à peu de clients mais fort volume.

Conséquences : `Grille-Offres-facture-gn.md` réécrit sur les sections 1 (nouvelle §1.4), 2 (colonne Starter Plus), 4 (grille à 6 paliers, paramètres versionnés `gateway_fee_djomy_bps` et `commission_*_bps` mis à jour) et 5 (cap Partner Free, nouvelle §5.4). Aucun changement de palier ni de catalogue de permissions (RBAC inchangé, ADR-097/104/105). La projection financière M18 (§8.1) n'est pas recalculée dans ce cycle — les nouveaux prix et taux la rendent caduque, mais un nouveau chiffrage exige des hypothèses de répartition des organisations par palier qui n'existent pas encore ; signalé comme travail restant plutôt que ré-estimé au jugé. Refonte structurelle au sens de la gouvernance §9 (nombre de paliers, structure du taux) — validée par le Sponsor, comme la refonte du 26/07.

---

## Partie 22 — Agent commercial terrain distinct du rôle RBAC field_agent (ADR-107)

Décision actée le 17 août 2026, en réponse à une confusion relevée par le Sponsor dans la maquette — mais dont l'origine remontait en amont, déjà présente dans Parcours-UX-Plan-de-test (§1.2) et Backlog (B5) : ces deux documents attribuaient l'inscription d'un nouveau marchand (Parcours 0, Chemin B) au rôle RBAC `field_agent`. Or `field_agent` est un rôle MVP scopé à une organisation **déjà existante** — personnel de la PME elle-même, assistant ses ventes via `assisted_session` (ADR-045/095) — sans aucun rapport avec le recrutement de nouvelles PME. B5 portait l'erreur plus loin encore, citant Fanta et Mariama — les personas **marchandes inscrites**, pas des agents — comme si elles exécutaient elles-mêmes l'inscription.

**ADR-107 — Agent commercial terrain : persona opérationnelle facture.gn, distincte du rôle RBAC field_agent**

Décision : Le Chemin B (agent qui inscrit un nouveau marchand n'ayant jamais utilisé facture.gn) est exécuté par un **Agent commercial terrain** — recruté et déployé par facture.gn pour ses activités de vulgarisation et d'acquisition terrain. **Déjà opérationnel dès aujourd'hui**, sans attendre la structuration d'un service commercial et vente dédié — ce service est son rattachement organisationnel futur, pas une condition pour que le poste existe et agisse sur le terrain. C'est bien un **accès délégué** (DAT §3.5), mais d'une nature différente des trois déjà cataloguées (mandat cabinet, `assisted_session` field_agent, invitation viewer) : ici la délégation vient de **facture.gn lui-même**, pas d'une PME — l'agent reçoit de facture.gn l'autorisation de créer une organisation en son nom et pour le compte du marchand consentant, jamais l'inverse. `ORGANIZATION.registration_source` reçoit une nouvelle valeur, `agent_terrain`, aux côtés de organic/apip/cga_referral/fodip/partner_3ae — le mécanisme de création reste technique­ment proche d'APIP (ADR-077), mais la délégation d'autorité, elle, est comptée et documentée comme un 4ᵉ type d'accès délégué (DAT §3.5).

Le rôle RBAC `field_agent` (MVP, 9 rôles) reste inchangé dans son périmètre d'origine : personnel *de la PME elle-même*, assiste aux ventes d'une organisation déjà existante via `assisted_session`, jamais de membership persistante (DAT §3.5, ADR-045) — aucun rapport avec l'inscription de nouveaux marchands.

Sékou (persona, CdC/PRD) est confirmé comme représentant l'Agent commercial terrain, pas le rôle RBAC `field_agent` — aucune persona MVP dédiée n'existe pour `field_agent` lui-même à ce stade (Ibrahima couvre `delivery_driver` ; `field_agent` reste décrit génériquement, sans incarnation nommée).

Conséquences : Backlog B5 corrigé (Agent commercial terrain / Sékou, plus « agent terrain (Fanta, Mariama) »). Parcours-UX §1.2 corrigé pour attribuer le Chemin B à l'Agent commercial terrain plutôt qu'à `field_agent`. DAT §3.5 reçoit un 4ᵉ type d'accès délégué (facture.gn → Agent commercial terrain, création d'organisation) aux côtés des trois déjà cataloguées. ERD et openapi.yaml : `registration_source` gagne la valeur `agent_terrain`. CdC/PRD : la description de Sékou précisée comme persona facture.gn, pas persona PME. Fiches-de-poste reçoit une nouvelle entrée pour ce poste, opérationnel dès maintenant, avec son rattachement prévu au futur service commercial et vente noté pour mémoire — pas comme condition d'activation. Maquette (shell 1) : le bouton d'inscription assistée retiré de l'accueil field_agent — il n'aurait jamais dû s'y trouver — l'inscription d'un nouveau marchand reste accessible uniquement depuis le point d'entrée « 00 · Inscription », sans manipulation du sélecteur de rôle PME.

---

## Partie 23 — client_portal : vérification par canal, OTP réservé à la PWA (ADR-108)

Décision actée le 20 août 2026, en cours d'audit F13 (client_portal) : ADR-096 (Partie 11) décrit la vérification comme « même flux PIN que le canal USSD » — formulation trop littérale une fois confrontée à l'usage réel. Un client PWA revient rarement et de façon irrégulière (contrairement à un marchand qui compose *620# fréquemment) ; lui imposer un PIN mémorisé de façon persistante dégrade l'expérience après une longue déconnexion, sans bénéfice de sécurité proportionné pour une identité en lecture seule (consultation de factures, jamais un paiement engagé sans étape de confirmation propre).

**ADR-108 — client_portal : OTP par SMS en PWA, PIN direct inchangé sur *620#**

Décision : Le mécanisme de **résolution d'identité** d'ADR-096 (`USER_PHONE.msisdn` → `CUSTOMER.phone`, toutes organisations confondues) ne change pas. Seul le **challenge de vérification** diverge désormais explicitement par canal :
- **PWA (client_portal web)** : code OTP à 4 chiffres envoyé par SMS à chaque connexion (ou après une session expirée) — jamais un PIN mémorisé à saisir de mémoire. Aucun `pinHash` n'est requis ni consulté pour ce canal.
- **USSD *620#** : inchangé, PIN direct si le téléphone est reconnu (Spec USSD §3.1, ADR-087) — l'infrastructure PIN existante (`UssdAuthService`) n'est pas concernée par cette décision, qui ne s'applique qu'au canal PWA.

Les deux canaux convergent vers la même identité `User`/`UserPhone` et donc vers le même client résolu à travers toutes les organisations — seul le mode de preuve de possession du numéro diffère, pas le résultat.

Conséquences : Backlog F13 corrigé — « Vérification par PIN via USER_PHONE, même flux que le canal USSD » devient « Vérification par OTP SMS en PWA (canal web) ; le canal *620# continue d'utiliser le PIN direct existant, ADR-087, inchangé ». ADR-096 (Partie 11) reste valide sur la résolution d'identité, amendée par ce document sur le seul point du mécanisme de vérification PWA. Aucun impact sur le schéma exposé par F13 (factures, running_balance/credit_limit) ni sur le périmètre RBAC. Implémentation future : nouveau mécanisme d'émission/vérification de code OTP à construire (aucun précédent réutilisable dans code/ — le seul autre OTP du produit est le `/confirm_otp` du provider Djomy, côté paiement, sans rapport). Maquette (shell 4, Portail client) déjà conforme à cette décision — aucune correction requise, c'est la lecture littérale d'ADR-096 qui était en retard sur l'intention produit.

---

## Partie 24 — Alignement EN 16931 et références B2G structurées (ADR-109)

Décision actée le 29 août 2026, en marge des travaux d'infrastructure « cap 10/10 » (restitution PDF, canal d'émission). Jusqu'ici le seul champ B2G modélisé est `INVOICE.reference_marche` (ADR-090, K3). L'agrément PDP visé Q3 2027 et l'export UBL 2.1 (ADR-053) supposent que la facture porte les *business terms* structurés d'EN 16931 — aujourd'hui absents, ce qui obligerait à les reconstruire ou les deviner au moment de l'export.

**ADR-109 — Champs B2G structurés alignés EN 16931, tous déclaratifs**

Décision : `INVOICE` gagne quatre champs et `INVOICE_LINE` un champ, tous **déclaratifs, recopiés tels quels à l'émission, sans aucune vérification automatique** — même discipline qu'ADR-090 (la cohérence avec le dossier de commande publique est rapprochée humainement par le DAF au moment de la validation de liquidation) :

| Champ | Business term EN 16931 | Rôle |
|---|---|---|
| `reference_marche` *(existant)* | BT-17 — Tender or lot reference | référence d'attribution du marché (TELEMO) |
| `cadre_facturation` *(nouveau, enum `standard` / `marche_public`)* | *hors EN 16931* | marqueur de contexte explicite, jamais dérivé de `customer.is_public_entity` |
| `numero_bon_commande` *(nouveau)* | BT-13 — Purchase order reference | bon de commande de l'acheteur |
| `numero_contrat` *(nouveau)* | BT-12 — Contract reference | référence du contrat/marché |
| `numero_engagement` *(nouveau)* | *hors EN 16931 core* — mappe BT-19 (Buyer accounting reference) à l'export UBL | numéro d'engagement budgétaire du Trésor, spécifique au B2G Guinée |
| `INVOICE_LINE.product_code` *(nouveau)* | BT-157 — Item standard identifier | référence article de l'acheteur / nomenclature (ex. CPV), distincte de `product_id` (catalogue interne PME) |

Le code de type de document UNTDID 1001 (BT-3 : `380` facture, `325` proforma, aucun code pour le devis) n'est **pas** stocké — il est dérivé de `document_type` par une fonction pure au moment de la restitution (PDF) et le sera à l'export UBL.

Aucune règle cross-field bloquante : `cadre_facturation = marche_public` **n'exige pas** `reference_marche` (ADR-090 impose ce champ optionnel, K3 l'a implémenté ainsi). `cadre_facturation` est posé côté serveur — `standard` par défaut, `marche_public` par l'Option 6 USSD « Commande Publique » et par le parcours PWA équivalent.

Conséquences : Migration additive (`20260829130000`), les factures existantes prennent `cadre_facturation = standard` et `NULL` sur les références. `ERD-facture-gn.md` et `openapi-facture-gn.yaml` à compléter (INVOICE + INVOICE_LINE + `createInvoiceSchema`). Aucun de ces champs n'entre dans `CertifiablePayload` (posés à la création du brouillon, jamais dans la signature Ed25519 — même garantie que `cost_price_at_time`, ADR-084). Le PDF de facture (restitution, Lot A) affiche le code UNTDID et un bloc « Références » quand au moins une référence est renseignée. `RecurringInvoiceTemplate` ne porte pas ces champs — les factures récurrentes sont `standard` sans référence (extension possible du modèle de gabarit, hors périmètre). Ces ajouts sont une **décision du propriétaire produit** en anticipation de l'agrément PDP, non une story pré-existante du Backlog — tracés ici pour qu'ils ne soient pas une exigence silencieusement introduite.

---

## Partie 25 — Clôture d'exercice OHADA (arrêté des comptes scellé) (ADR-110)

Décision actée le 29 août 2026, en marge des travaux « cap 10/10 ». Le DAT affirme la conformité OHADA/SYSCOHADA (« séquence sans trou Article 23, export FEC ») mais aucun mécanisme ne matérialise l'**arrêté des comptes** : la numérotation Article 23 et le chaînage Ed25519 protègent l'*ordre relatif* des factures, jamais les *bornes* d'un exercice. Rien n'empêche techniquement d'émettre « dans » un exercice déjà arrêté. C'est une exigence attendue pour l'agrément PDP (Q3 2027).

**ADR-110 — Sceau d'exercice irréversible, garde d'émission**

Décision : Nouvelle entité `FISCAL_PERIOD_CLOSING` — une organisation peut clôturer un exercice comptable (année civile) `year <= année courante` (jamais un exercice futur). La clôture :
- **agrège et fige** les totaux (HT / TVA / TTC), le nombre de factures et le dernier numéro/hash de séquence des factures *émises* (`issued` / `partially_paid` / `paid` / `voided` — jamais les `draft` / `proforma` / `quote`) dont `issued_at` tombe dans l'année (bornes **UTC**) ;
- calcule un `seal_hash` (SHA-256 canonique de l'ensemble, même primitive que la certification, ADR-021) ;
- est **idempotente** au niveau base (`@@unique(organization_id, year)`) et **irréversible** — aucune route de réouverture. Une erreur d'arrêté se corrige comptablement dans l'exercice suivant (principe OHADA), jamais en rouvrant.

`InvoicesService.issue()` gagne une garde, **dans la transaction verrouillée existante** : si l'exercice de l'année de `issued_at` (toujours l'année courante — `issued_at` n'est jamais fourni par le client) est clos, l'émission est refusée (409). C'est le seul vecteur réel : aucun antidatage n'existe dans le code.

Rôles : `POST /organizations/:id/fiscal-periods/:year/close` réservé à `owner` / `admin` / `accountant_internal` (le comptable salarié fait l'arrêté, ADR-099). Lecture `GET /organizations/:id/fiscal-periods` étendue à `auditor` et `tax_controller_readonly` (pièce de contrôle par nature).

Conséquences : Migration additive (`20260829140000`). `ERD-facture-gn.md` à compléter (nouvelle entité). Intégration du `seal_hash` dans `GET /verify` (vérification publique de la continuité d'un exercice) = évolution ultérieure, hors de cette décision. `seal_hash` n'entre jamais dans `CertifiablePayload` d'une facture (concerne l'exercice, pas la facture). Course `close()` × `issue()` concurrent : le sceau est un instantané meilleur-effort à la seconde ; une facture émise juste après le `close()` est bloquée par la garde, jamais silencieusement exclue de l'exercice suivant. Décision **du propriétaire produit** en anticipation de l'agrément PDP — non une story pré-existante du Backlog.

## Partie 26 — Row-Level Security PostgreSQL par organisation, dormante par défaut (ADR-111)

Décision actée le 29 août 2026, travaux « cap 10/10 » Vague 2. Le DAT annonce « PostgreSQL 16 + TimescaleDB (RLS par organisation et par cabinet/CGA) » mais l'isolation multi-tenant repose à 100 % sur des filtres applicatifs `where: { organizationId }` et le `RolesGuard`. Un seul oubli de filtre est une fuite cross-organisation — l'audit du 23/08/2026 en a trouvé un réel (`listMine()` exposait `bankAccountDetails` d'autres membres). RLS est la défense en profondeur attendue (Loi L/2016/037/AN, agrément PDP).

**ADR-111 — Politiques RLS posées mais dormantes ; activation par runbook supervisé**

Décision : La migration `20260829150000_enable_row_level_security` active `ROW LEVEL SECURITY` et crée une politique `org_isolation` sur 27 tables (18 à `organization_id` direct + `organization` + 8 indirectes via `invoice_id` / `credit_note` / `product`). Chaque politique est **doublement dormante** :
1. `ENABLE` **sans `FORCE`** → le rôle propriétaire des tables (rôle actuel des apps et des migrations) contourne toujours RLS ;
2. le prédicat commence par `current_setting('app.current_org_id', true) IS NULL OR …` → tant que le paramètre de session n'est pas défini, la politique laisse tout passer.

Le seul émetteur du paramètre est `organizationScopedClient(prisma, organizationId)` (`packages/db`) : une extension Prisma `$allOperations` qui exécute chaque opération dans une transaction précédée de `SELECT set_config('app.current_org_id', <orgId>, TRUE)` (`is_local = TRUE` → portée transaction, compatible pooler transaction-mode type PgBouncer, contrairement à un `SET` de session).

**Activation = chantier suivant, non ce lot.** Étapes réversibles décrites dans `docs/runbooks/rls-rollout.md` : (1) adopter `organizationScopedClient` service par service (du plus sensible au moins — `invoices`, `payments`, `customers`…) ; (2) créer un rôle applicatif `facture_app` non-propriétaire, sans `BYPASSRLS` ; (3) basculer `DATABASE_URL` applicative dessus, **valider l'isolation réelle sur staging** (Postgres réel — un test d'intégration `packages/db` gated `RLS_INTEGRATION_TEST=1` le vérifie) ; (4) `FORCE ROW LEVEL SECURITY` une fois tout le code migré.

Non couvert (phase 2, décision explicite) : `payment_webhook` (aucun lien organisation — table ops), `pending_member_invite` seulement partiellement (XOR `organization_id`/`practice_id` — clause NULL-permissive), et **toutes les tables scoped-practice** (le modèle d'accès mandat cabinet/CGA — un cabinet voit N organisations — demande sa propre conception RLS).

Conséquences : Migration additive, tournée par la CI (rôle superuser `postgres` → RLS reste dormant, les ~1290 tests inchangés). `schema.prisma` non modifié (RLS non représentable). Aucun câblage applicatif dans ce lot — donc aucune régression possible. Surcoût à surveiller après adoption : chaque opération scopée devient une transaction. Décision **du propriétaire produit** — pose l'infrastructure sans en assumer l'activation, qui reste une opération d'exploitation supervisée.

---

*facture.gn — Registre ADR — Document confidentiel — 29 août 2026*

