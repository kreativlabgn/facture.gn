# facture.gn — Spec USSD *620#

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Canal d'inclusion Feature phone

| Champ | Valeur |
|---|---|
| Date | 17 août 2026 |
| Code court | *620# (pas *800# — erreur corrigée) |
| Provider paiement | Orange Money Guinée via l'orchestrateur (Djomy primary, Moneroo fallback) |
| Statut | Consolidé — mandats cabinet/CGA, paiement partiel, orchestrateur multi-provider, multi-numéros (ADR-087), Option 6 Commande Publique (ADR-086), rôles V1 fantômes hors périmètre USSD par nature (ADR-097/104/105) |

> Tout ce qui est listé ici est le comportement attendu — le code doit le respecter exactement.

---

## 1. Menu principal — canonique

Le menu canonique est le point d'entrée unique.

```
facture.gn *620#

1. Payer une facture
2. Vérifier un reçu
3. Mes factures
4. Émettre une facture
5. Gérer mon compte
```

L'option 5 (Gérer mon compte) est un sous-menu étendu pour inclure la gestion des mandats cabinet/CGA.

---

## 2. Séquences détaillées

### 2.1 Option 1 — Payer une facture

Le montant affiché est amount_due (pas total_ttc) pour tenir compte des paiements partiels. Les frais de transaction (platform_fee) sont affichés séparément, portés par le payeur. Après confirmation et saisie du PIN, le paiement est exécuté via le provider résolu par l'orchestrateur — Djomy en primary pour Orange Money/MTN MoMo, bascule automatique vers Moneroo en cas de timeout.

### 2.2 Option 2 — Vérifier un reçu

Aucune authentification requise. Affiche le statut de contestation si différent de « none ».

### 2.3 Option 3 — Mes factures

Statuts affichés : Payée (paid), Non payée (issued), Partiel (partially_paid), Annulée (voided). Les proformas et devis ne sont pas affichés dans ce canal.

### 2.4 Option 4 — Émettre une facture

Séquence complète < 90 secondes. Signature serveur immédiate. Idempotence stricte. Lien de paiement généré et envoyé par SMS au client (si numéro renseigné) — provider résolu par l'orchestrateur. Plafonds velocity_tier vérifiés avant confirmation.

### 2.5 Option 5 — Gérer mon compte

5.1 Changer mon PIN · 5.2 Voir mon palier · 5.3 Mandats en attente · 5.4 Mandats actifs.

**5.3 — Mandats en attente**

Le cabinet ou le CGA demandeur s'affiche par son nom. Acceptation via PIN → mandat accordé, le cabinet/CGA peut consulter les factures.

**5.4 — Mandats actifs**

Liste des cabinets/CGA ayant accès, révocation possible avec PIN requis. L'acceptation et la révocation de mandat via USSD garantissent que les marchands feature phone (Mariama, Fanta) ne sont pas exclus de l'écosystème cabinet/CGA.

### 2.6 Option 6 — Commande Publique (V1, ADR-086)

6.1 Émettre une facture · 6.2 Statut de validation.

**6.1 — Émettre une facture**

Saisie condensée : montant, puis référence marché (optionnel — champ libellé « Référence marché TELEMO » si la PME en a une, ADR-090). Aucune vérification automatique de cette référence — recopiée à la main, rapprochée humainement par le DAF au moment de la validation. Génère une facture `document_type = invoice`, `customer.is_public_entity = true`. Même signature serveur immédiate, même idempotence que l'Option 4.

**6.2 — Statut de validation**

Consulte si le DAF de l'administration cliente a validé la liquidation (Niveau 2, ADR-080). Aucune information sur les visas Trésor ni le paiement effectif — ce niveau (3) n'est pas construit, pour ne pas rouvrir le risque R-02. Une fois validée, la PME choisit son rail de paiement (financement immédiat ou attente Trésor) depuis la PWA — pas depuis l'USSD, le choix implique une comparaison d'offres mieux servie par un écran riche.

Authentification identique aux options 1-5 : téléphone reconnu → PIN direct, sinon code compte + PIN. Aucun mécanisme de sécurité spécifique à un système tiers.

---

## 3. Authentification

### 3.1 Téléphone reconnu

MSISDN détecté → demande de PIN directement. Vérification contre `USER_PHONE` (ADR-087) — un même utilisateur reconnu sur plusieurs numéros enregistrés, pas seulement celui utilisé à l'inscription.

### 3.2 Téléphone emprunté

MSISDN inconnu → demande de code compte (8 car. Base32) + PIN (ADR-046).

### 3.3 PIN et sécurité

PIN 4 chiffres, 3 essais puis blocage 30 min. Reset PIN déclenche une bascule 24-48h vers T0 + SMS systématique.

---

## 4. Paliers de vélocité

Source unique dans le DAT. Deux axes indépendants : palier commercial (nombre illimité en Freemium, différenciation par fonctionnalités) et velocity_tier (montant).

| Palier | Par acte | Par jour | Par semaine | Par mois |
|---|---|---|---|---|
| T0 — non vérifié | 500 000 | 1 500 000 | 3 000 000 | 6 000 000 |
| T1 — vérifié DGI | 4 000 000 | 4 000 000 | 6 000 000 | 10 000 000 |
| T2 — T1+90j+0 flag | 20 000 000 | 20 000 000 | 50 000 000 | 100 000 000 |
| T3 — T2+12 mois | 80 000 000 | 80 000 000 | 200 000 000 | 400 000 000 |

*Montants en GNF. Le plus restrictif des deux plafonds (velocity_tier vs plafond opérateur) s'applique toujours.*

---

## 5. Raccourcis directs

Autorisés (émission anonyme et vérification uniquement) : `*620*1*250000#` (émission anonyme), `*620*2*A8K2P9Q1#` (vérification directe).

Non autorisés : tout raccourci exposant un client identifié en clair ou des données sensibles.

---

## 6. Ce que ce canal ne couvre pas

Proforma/devis. Remise/avoirs par ligne. Configuration régime fiscal et multi-succursale. Configuration récurrence. Forme juridique associative. Remboursement (PWA uniquement). L'acte de validation administrative B2G lui-même (réservé au portail acheteur public DAF, un persona qui n'utilise jamais *620# — la consultation du statut par la PME est en revanche couverte, Option 6.2). Choix du rail de financement B2G (Rail A/B, ADR-088) — décision comparative mieux servie par un écran riche, PWA uniquement. Vérification automatique d'une référence marché TELEMO — n'existe nulle part, ni USSD ni PWA (ADR-090). Gestion client avancée — fusion de doublons, limite de crédit (ADR-083) — et analytics avancé avec marge (ADR-084) : réservés à la PWA, jamais exposés sur un canal texte contraint. Même exclusion, même raison, pour les fonctionnalités des rôles V1 fantômes (ADR-097/104/105) : gestion de stock (inventory_manager), journal d'audit (auditor), clés API (developer_api), invitation d'un contrôleur fiscal (tax_controller_readonly) et marquage d'un client entité publique (customer:flag_public_entity) — aucune n'a de sens sur un menu texte à profondeur limitée.

Limite honnête : traduire le menu aide un locuteur lettré. Avec 68% d'analphabétisme, seul le canal vocal (V1) porte la promesse d'inclusion complète.

---

## 7. Journalisation et conformité CENTIF

MSISDN, IMEI si disponible, horodatage, montant. Détection comportementale sans seuil légal minimal. Frais opérateur portés par le payeur pour toute session liée à un paiement/encaissement. Gap non résolu : coût d'une session d'émission pure — coût réel à obtenir (deal Orange en chiffrage, B-06).

---

*facture.gn — Spec USSD *620# — Document confidentiel — 17 août 2026*
