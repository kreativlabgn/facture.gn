# facture.gn — PRD

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Product Requirements Document — référence produit unique

| Champ | Valeur |
|---|---|
| Date | 26 juillet 2026 |
| Statut | Consolidé — orchestrateur paiement, grille tarifaire 5 paliers, cartographie institutionnelle (TELEMO inclus), persona DAF, multi-numéros, Commande Publique PWA/USSD, financement B2G |
| Audience | Parties prenantes projet, squads de développement, partenaires |
| Documents liés | DAT · Backlog · Registre ADR · Spec USSD · Risques-RACI · Grille-Offres · Charte Graphique |

> Référence produit unique de facture.gn.

---

## 1. Vision & positionnement stratégique

### 1.1 Thèse

La confiance transactionnelle est le goulot d'étranglement de l'économie guinéenne. L'infrastructure qui la résout capture ensuite le paiement, puis le financement. facture.gn est cette infrastructure — en trois couches inséparables : Trust (certification cryptographique), Money (encaissement unifié), Capital (financement sur historique certifié).

### 1.2 Positionnement de marque — non négociable

facture.gn est un tiers de confiance privé certifié, jamais un registre ou une autorité d'État. La confiance vient d'une preuve cryptographique vérifiable (Ed25519, chaînage SHA-256), jamais d'un mandat gouvernemental réel ou suggéré. Prohibé : le mot « officiel », « République de Guinée » comme sous-titre de marque, tout tampon ou sceau imitant une autorité publique.

### 1.3 Marché

150 000 PME guinéennes, jusqu'à 2M factures/mois potentielles.

### 1.4 North Star metric

Taux d'encaissement > 95 % — factures émises payées dans les 30 jours.

---

## 2. Écosystème d'acteurs

### 2.1 Personas — PME et utilisateurs finaux

| Persona | Profil | Canal principal |
|---|---|---|
| Aissatou Diallo | PME import, Madina, boutique fixe | Smartphone, WhatsApp |
| Mamadou Barry | Comptable agréé, cabinet Kaloum | Multi-organisation, export FEC |
| Djénabou | Caissière Hôtel Riviera, arrhes/no-show | Smartphone, PWA |
| Ibrahima | Livreur, zone Coyah, offline terrain | Smartphone, offline-first |
| Sékou | Agent terrain EDG, Labé, pular | Offline prolongé |
| Aminata | Freelance design, devis → facture | Smartphone, lien de paiement |
| Mariama | Commerçante marché Madina, feature phone | USSD *620# |
| Fanta | Revendeuse en ligne, souvent non enregistrée | Smartphone, WhatsApp |
| Ousmane | Client final, payeur | Vérification sans compte |
| DGI | Administration fiscale — bénéficiaire structurel de l'élargissement de l'assiette (ADR-079) | Lecture agrégée, export FEC |
| DAF / Administration cliente | Directeur des affaires financières d'un ministère ou institution. Reçoit les factures certifiées de ses fournisseurs, valide la liquidation. Ne facture jamais via facture.gn. | Portail acheteur public (V1-V2, ADR-080) |
| Grossiste / Distributeur | Fournisseur imposant facture.gn à son réseau de boutiques clientes (commandes, paiements, crédit commercial) ; peut devenir partenaire de crédit privé (FINANCIAL_PARTNER type fournisseur_crediteur, ADR-100, V2, sous réserve de qualification juridique — R-16). | Dashboard organisation (analytics par client existant), import en masse de clients (gap, V1-V2) |

Hors cible, assumé : vendeurs ambulants sans emplacement fixe.

### 2.2 Partenaires professionnels — cabinet/CGA

Comptable agréé ou expert-comptable, inscrit à l'Ordre (OCAECG). Gère la comptabilité de 10 à 100+ PME. Multiplicateur d'adoption. Depuis le 26/07, le CGA (Centre de Gestion Agréé — décret du 17 février 2017, tutelle DGI, abattement fiscal -50%/-25% sur 3 ans) rejoint ce modèle comme 4e type de professional_practice (ADR-078), avec le même mécanisme mandate/dashboard/revenue share qu'un cabinet comptable.

### 2.3 Cartographie institutionnelle — positionnement « en dessous »

facture.gn ne fait pas de compta, ne fait pas de financement, ne fait pas d'accompagnement. C'est l'infrastructure qui permet à chaque acteur institutionnel de remplir sa propre mission.

| Acteur | Son KPI | Ce que facture.gn apporte | Nature de la relation |
|---|---|---|---|
| APIP | Nb entreprises créées/an | Auto-création du compte facturation dès la formalisation (webhook, ADR-077) | Canal d'acquisition à la source, V1 |
| CGA | Nb adhérents formalisés | Dashboard multi-adhérents, FEC sans rejet | Cockpit multi-tenant via professional_practice (ADR-078), V1 |
| DGI | Élargissement de l'assiette fiscale | FEC exploitable produit mécaniquement à chaque certification | Bénéficiaire structurel, jamais opérateur (ADR-079) |
| FODIP | Décaisser sur des projets PME mesurables | Projet mesurable avec traçabilité | Convention externe, dashboard lecture seule |
| 3AE / MIC | Structurer les PME, concours | Outil concret de structuration | Referral, codes promo |
| DAF / Administration cliente | Piloter l'encours fournisseurs | Réception de factures certifiées, validation de liquidation | Portail acheteur public, V1-V2 (ADR-080) |
| TELEMO | Digitaliser la passation des marchés publics | Continuité naturelle : la PME qui gagne un marché sur TELEMO le facture sur facture.gn | Partenaire amont, relais déclaratif (V1, ADR-090) |

---

## 3. Modèle économique

### 3.1 Principe fondamental

Le Freemium n'est jamais bloqué sur le volume d'émission ou d'encaissement — la différenciation se fait par les fonctionnalités, pas par le plafond de factures (décision 25/07, révise l'ancien modèle 30 factures/mois).

### 3.2 Trust — accès gratuit, fonctionnalités premium payantes

Tout le monde peut émettre et encaisser sans limite de volume. Les formules payantes débloquent : facturation récurrente automatique, multi-succursale, RBAC étendu (dont gestion client avancée — fusion de doublons, limite de crédit validée par approver, ADR-083), branding personnalisé, portail cabinet/CGA, analytics avancé avec marge produit (ADR-084), support avec SLA par sévérité (ADR-085), commission Money dégressive.

Matrice complète de fonctionnalités par palier (succursales, collaborateurs, rôles, analytics, support) : voir Grille-Offres.

### 3.3 Money — commission à l'encaissement non-cash, grille à 5 paliers (ADR-074)

Cash = 0 % de commission. Tout encaissement non-cash transite obligatoirement par un lien de paiement hébergé, orchestré Djomy (primary, Orange Money + MTN MoMo directs) / Moneroo (fallback, cartes internationales et bascule automatique sur timeout). La commission et les frais gateway sont portés par le payeur, jamais par le marchand.

| Tier | Abonnement | Com. affichée | Cible négo | Cap | Total payeur (+1% gateway Djomy) |
|---|---|---|---|---|---|
| Freemium | 0 GNF/mois | 2,5 % | 2,0 % | 50 000 GNF | 3,5 % |
| Starter | 75 000 GNF/mois | 2,0 % | 1,5 % | 50 000 GNF | 3,0 % |
| Pro | 250 000 GNF/mois | 1,5 % | 1,0 % | 75 000 GNF | 2,5 % |
| Enterprise | Sur devis | 1,2 % | 1,0 % | 100 000 GNF | 2,2 % |
| Custom volume | Négocié | 1,0 % | 0,8 % floor | 150 000 GNF | 2,0 % |

Grille en paramètre config versionné (ADR-058), ajustable sans refactoring. Projection M18 à 10k organisations : Money net 1 660M GNF/mois (+66 % vs 999M sous l'ancienne grille à taux unique), revenu total 2 080M GNF/mois ≈ 241k USD.

### 3.4 Modèle partenaire — cabinets et CGA

| Tier partenaire | Prix | Inclus |
|---|---|---|
| Partner Free | 0 GNF | Dashboard multi-org (≤10 entreprises), export FEC |
| Partner Starter | ~500 000 GNF/mois | ≤50 entreprises, statistiques, FEC consolidé |
| Partner Pro | ~1 500 000 GNF/mois | Illimité, branding, alertes conformité, API comptable |
| Partner Institutionnel | Sur devis | Co-branding, reporting personnalisé, support dédié |

Revenue share : le cabinet ou le CGA touche 10 % de la commission facture.gn générée par ses clients mandatés, plafond 5 000 GNF/mois/client. Encaissable via payment_link_payout (Djomy Payout, fallback Moneroo) ou déductible de l'abonnement.

### 3.5 Capital — apporteur d'affaires, jamais prêteur (V2)

Commission versée par la banque/MFI partenaire sur le montant financé.

---

## 4. Cycle de vie de la facture

### 4.1 Types de documents

| Type | Description | Paiement accepté | Certification |
|---|---|---|---|
| invoice | Facture standard (défaut) | Oui — tous modes | Oui à l'émission |
| proforma | Document commercial pré-vente | Arrhes/acompte uniquement | Non — jamais certifiée |
| quote | Devis, engagement de prix | Non — avant conversion | Non — jamais certifié |

### 4.2 Machine à états

draft → issued → partially_paid → paid (chemin normal). draft → issued → voided (annulation sans paiement). draft (proforma/quote) → converted → nouvelle facture draft. draft (quote) → expired.

Principe non négociable : une facture issued est immutable. Toute correction passe par un avoir (credit_note).

---

## 5. Parcours utilisateurs

### 5.1 Parcours B2G — entrepreneur et commande publique (V1-V2)

Entrepreneur gagne un marché sur TELEMO → émet une facture via PWA (parcours complet) ou *620# Option 6 (version condensée, ADR-086) — référence marché TELEMO recopiée en champ optionnel (ADR-090) → DAF valide la liquidation (portail dédié, public_buyer_validator, Niveau 2 — ADR-080) → Facture porte deux preuves : authenticité crypto + validation administrative → L'entrepreneur choisit son rail (PWA uniquement, comparaison d'offres) : **Rail A** — une banque/MFI partenaire avance immédiatement, disbursée via Djomy Payout ou virement au choix de la PME, remboursée ensuite par le Trésor (ADR-088) ; ou **Rail B** — attente du virement Trésor direct, sans financement. Dans les deux cas, aucune intégration SIGFIP active côté facture.gn — le paiement effectif de l'État, quand il a lieu, est détecté passivement par rapprochement bancaire.

### 5.2 Parcours Mamadou/CGA — comptable ou CGA multi-entreprises

Ouvre dashboard cabinet/CGA → Switch entre organisations mandatées (<1s) → Consulte factures, exporte FEC → Le mandat est accordé à l'entité practice, pas à un individu — un collaborateur qui part perd l'accès automatiquement (ADR-069).

### 5.3 Parcours Mariama — émission USSD *620#

Compose *620# → Menu : 4. Émettre une facture → Montant, client → PIN → Certification serveur immédiate → SMS confirmation.

---

## 6. RBAC — trois paliers révisés

MVP — 9 rôles : owner, admin, accountant_internal, cashier, field_agent, delivery_driver, client_portal, accountant_external, practice_admin. V1 — 19 rôles (ajout business_manager, inventory_manager, approver, auditor, viewer, tax_controller_readonly, support, sysadmin, developer_api, public_buyer_validator — avancé de V2, ADR-098). V2 — 20 rôles (platform_compliance_officer).

---

## 7. Exigences non-fonctionnelles

| Catégorie | Exigence | Mesure |
|---|---|---|
| Performance | API P95 Conakry | < 200 ms |
| Performance | Émission facture | < 2 s |
| Performance | Émission USSD | < 90 s |
| Disponibilité | Mensuelle | 99,9% |
| Offline | Autonomie PWA | 48h |
| Scalabilité | Organisations / factures | 10 000 orgs, 1M factures/mois |

---

## 8. Phasage & gouvernance

| Période | Jalon |
|---|---|
| T3 2026 | MVP beta fermée, 50+ PME pilotes |
| Q4 2026 | Audit sécurité externe |
| T4 2026-T1 2027 | Lancement national V1 |
| Q1 2027 | Dépôt dossier PDP |
| Q3 2027 | Agrément PDP visé |
| 2027-2028 | Consolidation V2, Capital Layer, B2G |

### 8.1 Gouvernance

| Rôle | Titulaire | Mandat |
|---|---|---|
| Sponsor exécutif | Bou Bakar | Décision finale, arbitrage budget, second signataire ≥ 10M GNF |
| Directrice Générale | À nommer | Pilotage opérationnel, validation seule ≤ 10M GNF |

---

## 9. Limites assumées

La certification protège une facture émise, pas une vente jamais déclarée. Un export UBL sans bloc d'extension cryptographique reste un document commercial, jamais une preuve légale. La validation administrative B2G constate la liquidation de la dette par le DAF, jamais le paiement effectif par le Trésor.

---

*facture.gn — PRD — Document confidentiel — 26 juillet 2026*
