# facture.gn — Cahier des Charges

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Exigences, contraintes et critères de réception

| Champ | Valeur |
|---|---|
| Date | 26 juillet 2026 |
| Audience | Parties prenantes projet, direction, comité de pilotage |
| Statut | Consolidé — intègre orchestrateur Djomy/Moneroo, partenaires institutionnels |
| Documents liés | Note Conceptuelle · PRD · DAT · Backlog · Registre ADR · Spec USSD · Risques-RACI · ERD |

> Le pont entre la vision stratégique et l'implémentation technique.

---

## 1. Objet du projet

Conception, développement et déploiement de facture.gn — Infrastructure Nationale de Confiance Transactionnelle pour les PME de Guinée. Plateforme en trois couches (Trust, Money, Capital) déployée en trois phases (MVP, V1, V2) sur 18 mois.

facture.gn est un tiers de confiance privé certifié — jamais un registre ou une autorité d'État.

---

## 2. Périmètre fonctionnel

### 2.1 MVP (M1-3, 50+ pilotes Conakry)

Trust Layer complet. Tous moyens de paiement : cash avec preuve, orchestrateur de paiement (Djomy primary — Orange Money + MTN MoMo directs, Moneroo fallback — cartes internationales et bascule automatique), virement bancaire. Commission payeur sur encaissement non-cash — grille à 5 paliers (ADR-074). Proforma et devis avec conversion. Paiement partiel. Annulation (voided). Régime fiscal dès J1. Offline 48h. RBAC 9 rôles. Export FEC. USSD *620#. Multi-numéros par utilisateur (USER_PHONE, ADR-087). Vérification NIF+eTax. Dashboard cabinet/CGA (consultation + FEC + switch). Système de mandats.

### 2.2 V1 (M4-9, lancement national)

USSD étendu et vocal multilingue. Facturation récurrente et rappels. MTN MoMo et Wave via l'orchestrateur. RBAC 19 rôles. Portail cabinet/CGA complet. Badge vérifié Ordre OCAECG. Export UBL 2.1. Portail administration publique — validation DAF Niveau 2 pour le B2G (ADR-080). Webhook APIP, modèle Partner générique pour CGA/FODIP/3AE (ADR-077/078). Option 6 Commande Publique — émission B2G + statut liquidation, USSD et PWA (ADR-086), relais déclaratif TELEMO (ADR-090). Contact commercial MFI.

### 2.3 V2 (M10-18, Capital Layer)

Capital Layer complet. Scoring segmenté. Factoring B2G, is_financeable() opérationnel. Portail bancaire avec API dédiée. Financement B2G à deux rails — avance FINANCIAL_PARTNER ou attente Trésor (ADR-088), anti-double financement concrétisé (ADR-089). Sous-clé terrain offline prolongée. Agrément PDP. Portabilité complète.

### 2.4 Hors périmètre — explicite

Tout pays hors Guinée. Paie/RH. Financement direct avant partenariat bancaire. Alias facture.gn. Cycle fournisseur/achat. Multi-devise réelle. Chèque dans le flux certifié. Vendeurs ambulants. Crypto (pas de statut légal confirmé en Guinée, risque LBC/FT). eIDAS avant 2027. Marketplace B2B opérée par facture.gn (ADR-101) — infrastructure uniquement, toute marketplace reste un tiers consommant l'API.

---

## 3. Utilisateurs et parties prenantes

### 3.1 Dix personas PME + DAF

Aissatou (boutique), Mamadou (comptable agréé), Djénabou (hôtel, arrhes), Ibrahima (livreur, offline), Sékou (Agent commercial terrain facture.gn — pas une PME, inscrit de nouveaux marchands, ADR-107), Aminata (freelance, devis), Mariama (marché, *620#), Fanta (e-commerce, non enregistrée), Ousmane (client payeur), DGI (bénéficiaire structurel de l'assiette fiscale, ADR-079), DAF / Administration cliente (valide la liquidation des factures B2G, ADR-080).

### 3.2 Partenaires professionnels et institutionnels

Cabinets comptables et CGA (entité professional_practice à 4 types, dashboard multi-org, mandats, revenue share — ADR-078). Gestionnaires d'activité (V1). Ordre des Comptables OCAECG. APIP (canal d'acquisition webhook, V1). FODIP et 3AE (conventions externes, hors plateforme). Administrations publiques (validation commandes publiques, V1-V2). Banques et MFI (vérification, financement, V2). Grossistes fournisseurs (relation commerciale déjà couverte par l'existant — boutique cliente via CUSTOMER ; nouvelle relation de crédit privé via FINANCIAL_PARTNER.type=fournisseur_crediteur, V2, sous réserve d'avis juridique préalable — R-16, ADR-100).

### 3.3 Gouvernance

| Rôle | Titulaire | Périmètre de décision |
|---|---|---|
| Sponsor exécutif | Bou Bakar | Budget, scope, relations institutionnelles |
| Directrice Générale | À nommer | Pilotage opérationnel ≤ 10M GNF |
| Product Owner | À nommer | Priorisation backlog |
| Tech Lead/Architecte | À nommer | Décisions architecture (ADR) |

---

## 4. Contraintes

### 4.1 Contraintes techniques

Coupures électriques fréquentes (EDG). Réseau 2G/3G instable. Terminaux bas de gamme. 68% d'analphabétisme. Offline obligatoire (48h minimum).

### 4.2 Contraintes réglementaires

OHADA/SYSCOHADA (Article 23). Loi L/2016/037/AN (protection des données). Loi L/2021/024/AN (LBC/FT). Fenêtre PDP 2027-2028 (incertaine). Régimes fiscaux guinéens (seuils en paramètre config).

### 4.3 Contraintes opérationnelles

Orchestrateur de paiement : Djomy.africa (primary — couverture Orange Money Guinée + MTN MoMo Guinée directs, frais 1% annoncés à confirmer) et Moneroo (fallback — cartes internationales et bascule automatique sur timeout 10s). KYB et délais de versement à valider pour les deux providers. Code USSD *620# — frais opérateur portés par le payeur pour les sessions paiement. Coût réel de session d'émission pure à obtenir. Deal Orange en chiffrage (0,5% commission Money contre USSD gratuit à l'émission).

---

## 5. Exigences non-fonctionnelles

| Catégorie | Exigence | Mesure |
|---|---|---|
| Performance | API P95 Conakry | < 200 ms |
| Performance | Émission facture | < 2 s |
| Performance | Émission USSD | < 90 s |
| Performance | Switch organisation (cabinet/CGA) | < 1 s |
| Performance | Génération lien paiement | < 3 s |
| Performance | Latence orchestrateur p95 | < 180 ms |
| Disponibilité | Mensuelle | 99,9% |
| Offline | Autonomie PWA | 48h |
| Sécurité | Signature / transport / stockage | Ed25519, TLS 1.3, AES-256 |
| Scalabilité | Capacité | 10 000 orgs, 1M factures/mois |
| Archivage | Rétention preuves | WORM 10 ans (MinIO) |

---

## 6. Organisation et équipe

4 squads : Trust, Money (paiements orchestrés, offline, USSD), Capital, Platform. Chaque squad : 1 tech lead + 2-3 devs + 1 QA. Definition of Done : revue par 2 pairs, couverture ≥85%, revue sécurité si auth/RBAC/crypto/paiements/PII.

---

## 7. Lots de livrables

Mappés aux 4 squads, phasés MVP/V1/V2. Détail dans le Backlog (69 stories). Chaque story référence l'ADR qui la justifie (90 décisions dans le Registre ADR).

---

## 8. Critères de réception MVP

| Critère | Mesure | Méthode de validation |
|---|---|---|
| Zéro perte de données après coupure réseau | 0 facture perdue sur 1000 tests | Test de résilience réseau |
| Offline 48h démontré | Émission + encaissement après 48h sans réseau | Test terrain Coyah |
| QR vérifiable sans internet | Vérification offline via verify-gn.js | Test en mode avion |
| FEC exportable sans rejet | 0 rejet sur fichier test anonymisé | Test logiciel comptable réel |
| Orange Money > 98% succès (via Djomy) | Taux sur 24h glissantes | Monitoring orchestrateur + polling |
| USSD < 90s sur feature phone | Chronométrage terrain | Test avec Mariama |
| TTV < 5 min | Inscription → première facture test | Test avec Aissatou |
| Commission captée sans fuite | 100% des paiements non-cash via lien de paiement orchestré | Audit réconciliation webhook/payment |
| Bascule Djomy→Moneroo prouvée | Timeout 10s → transaction complétée sans intervention | Test de bascule automatique (Chantier 2) |

---

## 9. Planning indicatif

| Période | Jalon |
|---|---|
| T3 2026 | MVP beta fermée, 50+ PME pilotes Conakry |
| Q4 2026 | Audit sécurité externe |
| T4 2026-T1 2027 | Lancement national V1 |
| Q1 2027 | Dépôt dossier PDP |
| Q3 2027 | Agrément PDP visé |
| 2027-2028 | Consolidation V2, Capital Layer, B2G |

---

## 10. Budget indicatif

⚠ Aucun chiffrage détaillé n'existe à ce jour. Postes à chiffrer : équipe (4 squads, 12-16 développeurs, 18 mois), infrastructure cloud, services tiers (Djomy, Moneroo, USSD, WhatsApp Business API, SMS), conformité & audit, acquisition, gouvernance, contingence 15-20%.

---

## 11. Risques majeurs

36 risques identifiés dans le Registre des Risques. Les plus structurels : DGI modèle centralisé (R-02, critique), adoption PME insuffisante (B-01, élevé), vendor lock-in Djomy (R-13, nouveau 26/07, mitigé par fallback Moneroo prouvé), absence de chiffrage budgétaire (G-02, élevé). NimbaPay (R-12) et TELEMO (R-15) : surveillance active. Adoption administration B2G (R-14, nouveau 26/07) : latent, V2.

---

## 12. Glossaire

| Terme | Définition |
|---|---|
| ADR | Architecture Decision Record |
| CENTIF | Cellule Nationale de Traitement des Informations Financières |
| DAT | Document d'Architecture Technique |
| DGI | Direction Générale des Impôts |
| FEC | Fichier des Écritures Comptables |
| OHADA | Organisation pour l'Harmonisation en Afrique du Droit des Affaires |
| PDP | Plateforme de Dématérialisation Partenaire |
| TPU | Taxe Professionnelle Unique |
| velocity_tier | Palier gouvernant les plafonds de montant (T0-T3) |
| Djomy | Provider de paiement primary (djomy.africa), couvre Orange Money + MTN MoMo Guinée en direct |
| Moneroo | Agrégateur de paiement fallback — moneroo.io, cartes internationales et bascule automatique |
| NimbaPay | Système de paiement instantané national (BCRG/GuiM, Mojaloop) |
| OCAECG | Ordre des Comptables Agréés et Experts Comptables de Guinée |
| CGA | Centre de Gestion Agréé — décret 17/02/2017, abattement fiscal PME |
| APIP | Agence de Promotion des Investissements Privés |
| FODIP | Fonds guinéen visé pour le financement de programmes PME (PADIRPME BAD) |

---

*facture.gn — Cahier des Charges — Document confidentiel — 26 juillet 2026*
