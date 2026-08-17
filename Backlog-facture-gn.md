# facture.gn — Backlog

**Infrastructure de Facturation Certifiée · PME de Guinée**

## User Stories actionnables

| Champ | Valeur |
|---|---|
| Date | 17 août 2026 |
| Statut | Consolidé — 76 stories (57 du 25/07 + 4 partenaires/B2G du 26/07 + 4 grille des offres/analytics + 4 multi-numéros/Commande Publique/financement du 26/07 + 1 score de confiance du 08/08 + 2 du 14/08 [E9 grossiste, F13 client_portal, non comptées dans le total précédent] + 4 rôles V1 sans story du 17/08, ADR-097/104) |
| Audience | Squads de développement, QA, Product Owner |
| Priorité | MoSCoW : MUST = bloquant MVP, SHOULD = V1, COULD = V2 |

> Chaque story référence l'ADR qui la justifie.

---

## Sommaire des sections

| Section | Contenu | Stories |
|---|---|---|
| A | Trust Layer — certification et vérification | A1–A4 |
| B | Inscription, vérification DGI et onboarding | B1–B6 |
| C | Money Layer — encaissement, paiement, commission | C1–C20 |
| D | Canal USSD *620# | D1–D4 |
| E | Commerce ordinaire | E1–E10 |
| F | RBAC, accès délégué et écosystème cabinet/CGA | F1–F15 |
| G | Conformité et sécurité comportementale | G1–G4 |
| H | Modèle économique — tiers, partenaires, facturation | H1–H4 |
| I | Facturation récurrente, rappels, multi-devise, formes juridiques | I1–I4 |
| J | V1 — lancement national, dont partenaires institutionnels | Prose descriptive (pas de stories numérotées) |
| K | V2 — Capital Layer et B2G | K1–K5 + périmètre V2 en prose |

---

## A. Trust Layer — certification et vérification

**A1 — Émettre une facture certifiée `[MUST]`**
En tant qu'organisation, je veux émettre une facture draft qui devient certifiée à l'émission, afin d'avoir une preuve cryptographique immutable de la transaction.
- POST /invoices/{id}/issue attribue number et certification_id
- Payload canonicalisé (FGN-Canon-v1) et signé Ed25519
- Lien de paiement généré automatiquement, provider résolu par l'orchestrateur (Djomy primary, ADR-060/072)

Réf : ADR-021, ADR-022, ADR-060, ADR-072

**A2 — Vérifier une facture publiquement `[MUST]`**
En tant que quiconque (Ousmane, banque, DGI), je veux vérifier l'authenticité d'une facture par certification_id sans compte, afin d'avoir confiance dans le document sans dépendre de facture.gn.
- Vérification sans authentification, offline via verify-gn.js
- Affiche statut de paiement, dispute_status, validation admin (si applicable)

Réf : ADR-041

**A3 — Provisionner la clé racine d'une organisation `[MUST]`**
En tant que système, je veux générer une clé racine Ed25519 en HSM, afin de garantir une identité cryptographique unique.
- Génération HSM cloud, jamais exportée

Réf : ADR-026

**A4 — Consulter le registre émetteur `[SHOULD]`**
En tant que vérificateur externe, je veux vérifier qu'une clé était valide à la date d'émission, afin de détecter une facture signée avec une clé révoquée.
- Vérification à la date d'émission, pas à l'horloge courante

Réf : ADR-025

---

## B. Inscription, vérification DGI et onboarding

**B1 — Inscrire une organisation avec vérification NIF+eTax `[MUST]`**
En tant que nouvelle PME, je veux m'inscrire avec mon NIF et numéro eTax, afin d'être identifiable par la DGI dès le départ.
- NIF et eTax exigés conjointement (optionnels à l'inscription — B4)
- dgi_verification_status démarre à unverified

Réf : ADR-035, ADR-036

**B2 — Faire passer une organisation en statut vérifié `[MUST]`**
En tant que système, je veux vérifier le NIF+eTax, afin de débloquer velocity_tier T1.
- Passage à verified déclenche T0→T1

Réf : ADR-036

**B3 — Récupérer l'accès à un compte owner perdu `[MUST]`**
En tant que propriétaire ayant perdu son accès, je veux récupérer mon compte sans perdre mes données, afin de ne pas être bloqué par un appareil perdu.
- Backup admin obligatoire, récupération via support + recovery_pending

Réf : ADR-042

**B4 — Onboarding self-service avec inscription incomplète possible `[MUST]`**
En tant que nouvelle PME connectée (Aissatou, Aminata), je veux m'inscrire en moins de 5 minutes et émettre immédiatement, afin de ne pas être bloquée par des informations que je n'ai pas.
- NIF+eTax optionnels → statut unverified (T0)
- TTV < 5 min

Réf : ADR-045, Parcours 0 Chemin A

**B5 — Onboarding assisté avec session traçable `[MUST]`**
En tant qu'agent terrain (Fanta, Mariama), je veux inscrire un marchand via une session assistée, afin de rendre le marchand opérationnel immédiatement, sans qu'il ait à naviguer seul.
- assisted_session créée, jamais de membership persistant

Réf : ADR-045, Parcours 0 Chemin B

**B6 — Être reconnu sur plusieurs numéros de téléphone `[MUST]`**
En tant qu'utilisateur avec un numéro personnel et un numéro professionnel, je veux être reconnu sur *620# quel que soit le numéro utilisé, afin de ne pas ressaisir mon code compte à chaque changement de téléphone.
- Table USER_PHONE (user_id, msisdn, is_primary, verified_at) remplace le champ phone unique
- Aucun impact sur la clé cryptographique, toujours par organisation/canal

Réf : ADR-087

---

## C. Money Layer — encaissement, paiement, commission

**C1 — Encaisser en cash avec preuve `[MUST]`**
En tant qu'organisation, je veux enregistrer un paiement cash avec preuve, afin d'avoir une trace vérifiable.
- Photo/GPS/signature obligatoire >1M GNF
- Commission = 0%

Réf : ADR-016

**C2 — Encaisser via lien de paiement orchestré (Djomy primary, Moneroo fallback) `[MUST]`**
En tant qu'organisation, je veux que mon client paie en cliquant sur un lien, afin d'encaisser sans coordination manuelle.
- Lien généré à l'émission, résolu par l'orchestrateur (ADR-072/073)
- Djomy couvre Orange Money + MTN MoMo Guinée en direct
- Bascule automatique vers Moneroo si timeout Djomy 10s
- Commission captée atomiquement (ADR-061)

Réf : ADR-060, ADR-061, ADR-072, ADR-073

**C3 — Encaisser par virement bancaire `[SHOULD]`**
En tant qu'organisation, je veux accepter un virement, afin de couvrir les clients qui préfèrent le virement.
- payment.method = bank_transfer, rapprochement asynchrone

Réf : ADR-052

**C4 — Appliquer le bon régime fiscal `[MUST]`**
En tant qu'organisation, je veux que le régime soit appliqué automatiquement, afin d'être conforme sans effort.
- Quatre valeurs : normal_tva, tpu, normal_sans_tva, non_assujetti_association

Réf : ADR-033, ADR-057

**C5 — Encaisser des arrhes avec forfait automatique no-show `[MUST]`**
En tant qu'organisation hôtelière (Djénabou), je veux encaisser des arrhes et appliquer le forfait, afin de sécuriser les réservations.
- deposit_type = arrhes sur proforma

Réf : ADR-034, ADR-064

**C6 — Suivre le solde d'un client à crédit récurrent `[SHOULD]`** — Réf : ADR-039
**C7 — Émettre un avoir partiel sur des lignes précises `[SHOULD]`** — Réf : ADR-040
**C9 — Envoyer le lien de paiement au client (WhatsApp/SMS) `[MUST]`** — Réf : ADR-060
**C10 — Suivre le statut d'un paiement en temps réel `[SHOULD]`**

**C8 — Encaisser via lien de paiement, provider transparent au marchand `[MUST]`**
En tant qu'organisation, je veux qu'un lien soit généré automatiquement à l'émission, afin de permettre à mon client de payer sans coordination manuelle.
- Lien généré en <3s après émission
- payment.amount = invoice.total_ttc (montant net marchand)
- Le choix Djomy/Moneroo est interne à l'orchestrateur, invisible au marchand

Réf : ADR-060, ADR-072

**C11 — Encaisser un paiement partiel `[MUST]`**
En tant qu'organisation, je veux encaisser un montant inférieur au total dû, afin de refléter la réalité terrain.
- Statut passe à partially_paid
- Nouveau lien pour le solde restant

Réf : ADR-062

**C12 — Mixer les modes de paiement sur une même facture `[SHOULD]`** — Réf : ADR-062
**C14 — Gérer un trop-perçu cash `[SHOULD]`** — Réf : ADR-063
**C15 — Créer une proforma et la convertir en facture `[MUST]`** — Réf : ADR-064
**C16 — Créer un devis et le convertir en facture `[SHOULD]`** — Réf : ADR-064

**C13 — Rembourser un client après avoir `[SHOULD]`**
En tant qu'organisation ayant émis un avoir, je veux enregistrer le remboursement réel, afin de refléter fidèlement le mouvement d'argent dans ma comptabilité.
- refund ne peut être créé que sur un credit_note existant
- Modes : cash, payment_link_payout (Djomy Payout, fallback Moneroo), virement, crédit en compte

Réf : ADR-063

**C17 — Annuler une facture émise sans paiement `[MUST]`**
En tant qu'organisation, je veux annuler une facture émise par erreur, afin de ne pas polluer ma comptabilité.
- Rejeté si un payment existe → utiliser l'avoir
- Numéro FG- jamais réutilisé

Réf : ADR-065

**C18 — Régénérer un lien de paiement expiré `[SHOULD]`** — Réf : ADR-066

**C19 — Afficher les frais de transaction au payeur `[MUST]`**
En tant que payeur (client), je veux voir le montant exact avant de confirmer, afin de ne pas être surpris.
- Page Checkout : montant facture + frais + total
- Frais calculés selon le provider résolu (Djomy 1% ou Moneroo)
- Ligne informative sous le détail des frais expliquant leur finalité (certification de la transaction + historique reconnu par les partenaires financiers) — jamais de comparaison nominative à un concurrent

Réf : ADR-067, ADR-074, ADR-094

**C20 — Configurer l'envoi du lien (immédiat ou différé) `[SHOULD]`** — Réf : Parcours Aminata

---

## D. Canal USSD *620#

**D1 — Émettre une facture via *620# `[MUST]`**
En tant qu'agent terrain, je veux émettre une facture depuis mon feature phone, afin de facturer sans smartphone.
- Séquence < 90s
- Signature serveur immédiate

Réf : ADR-044

**D2 — S'authentifier avec un téléphone emprunté `[MUST]`** — Réf : ADR-046
**D4 — Respecter les plafonds de vélocité T0-T3 `[MUST]`** — Réf : ADR-050

**D3 — Vérifier et encaisser via USSD `[MUST]`**
En tant que payeur ou marchand, je veux vérifier et payer via *620#, afin d'avoir les mêmes garanties que sur la PWA.
- Frais opérateur portés par le payeur
- Paiement exécuté via le provider résolu par l'orchestrateur

Réf : ADR-044, ADR-072

---

## E. Commerce ordinaire

**E1 — Gérer plusieurs points de vente `[SHOULD]`**
En tant qu'organisation multi-sites, je veux rattacher mes factures à des succursales, afin de suivre le CA par point de vente.
- branch sous organization

Réf : ADR-037

**E2 — Appliquer une remise globale à une facture `[MUST]`**
**E3 — Éviter les doublons client/produit en offline `[SHOULD]`** — Réf : ADR-038

### Nouvelles stories — Grille des Offres, gestion client et analytics (26/07)

**E4 — Fusionner des clients dupliqués `[SHOULD]`**
En tant qu'admin ou owner, je veux fusionner deux fiches client identifiées comme doublons, afin de garder un historique de facturation propre.
- Permission customer:merge_duplicate — admin/owner uniquement, jamais cashier ni field_agent
- Distinct de E3 : E3 prévient les doublons en offline, E4 résout ceux déjà créés

Réf : ADR-038, ADR-083

**E5 — Définir ou augmenter la limite de crédit d'un client `[SHOULD]`**
En tant qu'admin ou owner, je veux définir une limite de crédit, afin de contrôler mon exposition financière sur les clients réguliers.
- Permission customer:manage_credit_limit — admin/owner uniquement
- Toute augmentation au-delà d'un seuil (paramètre config) exige une validation par le rôle approver — jamais une décision unilatérale

Réf : ADR-083

**E6 — Renseigner le coût d'achat d'un produit `[SHOULD]`**
En tant qu'organisation, je veux renseigner le coût d'un produit, afin de pouvoir suivre ma marge sans être obligée de le faire à la création.
- PRODUCT.cost_price nullable — la création du produit n'est jamais bloquée en son absence

Réf : ADR-084

**E7 — Consulter la marge par produit et par vente `[SHOULD]`**
En tant qu'owner, admin ou business_manager, je veux voir la marge réalisée par produit, afin de piloter la rentabilité réelle de mon activité.
- Permission analytics:view_margin — jamais accessible à cashier/field_agent, même en palier Pro
- Marge calculée sur INVOICE_LINE.cost_price_at_time (snapshot à la facturation), jamais recalculée rétroactivement si le coût change ensuite

Réf : ADR-084

### Nouvelle story — Score de confiance transactionnelle (08/08)

**E8 — Visualiser mon taux de paiements vérifiés `[SHOULD]`**
En tant qu'owner ou admin, je veux voir la part de mes encaissements réglée par lien de paiement plutôt qu'en cash, afin de comprendre la qualité de mon historique en vue d'un futur accès au crédit.
- Calcul dérivé de payment.method, aucune nouvelle donnée ni brique d'infrastructure
- Affichage strictement informatif — jamais un gate de fonctionnalité, jamais exposé à un tiers externe au MVP
- Visible dès Freemium, tous paliers

Réf : ADR-093

### Nouvelle story — Grossiste fournisseur (14/08)

**E9 — Importer mes clients en masse `[SHOULD]`**
En tant que grossiste imposant facture.gn à mon réseau de boutiques, je veux importer plusieurs centaines de fiches client d'un coup, afin d'onboarder mon réseau en quelques jours plutôt qu'une fiche à la fois.
- Import CSV, dédoublonnage par téléphone à l'import (réutilise la logique de possible_duplicate_of, E4)
- Aucune permission nouvelle — même garde-fou que la création unitaire de client
- Ne crée jamais de compte facture.gn pour la boutique — seulement une fiche CUSTOMER ; la boutique reste libre de créer sa propre organisation séparément (ADR-100)

Réf : ADR-100

### Nouvelle story — inventory_manager sans story malgré sa permission (ADR-097) (17/08)

**E10 — Gérer les niveaux de stock par succursale `[SHOULD]`**
En tant qu'inventory_manager (ou owner/admin), je veux enregistrer les réceptions et ajustements de stock par succursale, afin de garder mes niveaux de stock à jour sans dépendre d'un tableur externe.
- Permission `inventory:manage_stock` (ADR-097) — mouvement (réception, ajustement d'inventaire, perte/casse) rattaché à `PRODUCT_STOCK.stock_qty` (déjà en base, ERD), par succursale (branch, ADR-037)
- inventory_manager ne voit jamais `cost_price` ni la marge (territoire business_manager, ADR-070/084), sauf cumul explicite de rôle
- Un stock insuffisant n'a jamais bloqué l'émission d'une facture — même philosophie que `cost_price` (ERD) : jamais un gate, seulement une alerte

Réf : ADR-037, ADR-070, ADR-084, ADR-097

---

## F. RBAC, accès délégué et écosystème cabinet/CGA

**F1 — Inviter un comptable externe (via mandat cabinet) `[MUST]`**
En tant que propriétaire d'organisation, je veux accorder l'accès via un mandat, afin de permettre à mon comptable d'exporter mon FEC.
- Le mandat est accordé au cabinet, pas à un individu
- Acceptation explicite (PWA ou *620# option 5.3 + PIN)

Réf : ADR-068, ADR-069

**F2 — Assister une organisation sans accès permanent `[MUST]`** — Réf : ADR-045
**F3 — Inviter un proche/assistant depuis *620# `[SHOULD]`**

**F4 — Créer un cabinet comptable ou un CGA `[MUST]`**
En tant que comptable agréé (Mamadou) ou responsable CGA, je veux créer mon entité sur facture.gn, afin de gérer tous mes clients depuis un point d'entrée.
- POST /practices crée un professional_practice
- type ∈ {cabinet_comptable, gestionnaire, fiduciaire, cga} — ADR-078
- Créateur devient practice_admin
- N° Ordre OCAECG ou agrément CGA optionnel (badge si vérifié)

Réf : ADR-068, ADR-078

**F5 — Demander un mandat sur une organisation `[MUST]`**
En tant que comptable ou CGA, je veux demander l'accès comptable à un client, afin de consulter ses factures et exporter son FEC.
- POST /practices/{id}/mandates
- Acceptation via PWA ou *620# (option 5.3 + PIN)

Réf : ADR-069

**F6 — Révoquer un mandat `[MUST]`** — Réf : ADR-069
**F7 — Switcher entre organisations depuis le dashboard cabinet/CGA `[MUST]`**
**F8 — Inviter un collaborateur au cabinet/CGA `[SHOULD]`** — Réf : ADR-068
**F9 — Exporter le FEC depuis le dashboard cabinet/CGA `[MUST]`**
**F10 — Inviter un client non encore inscrit `[SHOULD]`** — Réf : ADR-068

### Nouvelles stories — Partenaires institutionnels (26/07)

**F11 — Recevoir une organisation créée depuis APIP `[SHOULD]`**
En tant que facture.gn, je veux auto-créer une organisation à partir d'un webhook APIP, afin de capter les nouvelles PME à la source de leur formalisation.
- Webhook authentifié API key + HMAC-SHA256 (ADR-082)
- registration_source = apip (ADR-077)
- Organisation créée en Freemium, T0, unverified
- SMS d'accueil avec lien d'activation

Réf : ADR-077, ADR-082

**F12 — Adhérer à un CGA depuis facture.gn `[SHOULD]`**
En tant qu'organisation, je veux adhérer à un CGA référencé, afin de bénéficier de l'abattement fiscal.
- Bouton « Adhérer à un CGA » → liste des CGA actifs (professional_practice type cga)
- Demande de mandat → notification au CGA → acceptation → mandat actif
- Le personnel du CGA accède au dashboard multi-adhérents comme un cabinet comptable classique

Réf : ADR-078

### Nouvelle story — Identité client_portal (14/08)

**F13 — Consulter mes factures reçues, tous émetteurs confondus `[MUST]`**
En tant que client d'une ou plusieurs organisations facture.gn, je veux vérifier mon numéro de téléphone une fois et voir toutes mes factures reçues, afin de suivre mes paiements sans dépendre d'un accès accordé par chaque organisation.
- Vérification par PIN via USER_PHONE (même flux que le canal USSD, ADR-087) — aucune invitation préalable requise
- Résolution automatique de `CUSTOMER.phone` sur l'ensemble des organisations, à la volée, sans nouveau champ de schéma
- Par organisation : liste de factures (statut, montant, lien de paiement si impayée, certification_id), running_balance/credit_limit propres à ce client — jamais les données d'un autre client
- F10 (inviter un client non inscrit) reste un mécanisme de découverte complémentaire, jamais une condition d'accès

Réf : ADR-096

### Nouvelles stories — Rôles V1 sans story malgré leur permission (ADR-097/104) (17/08)

**F14 — Inviter un contrôleur fiscal en lecture seule `[SHOULD]`**
En tant qu'owner ou admin, je veux inviter un contrôleur fiscal local à consulter en lecture seule mes propres factures et exporter mon FEC, afin de faciliter un contrôle sans partager mon PIN ni lui donner plus d'accès que nécessaire.
- Rôle `tax_controller_readonly` (renommé depuis dgi_readonly, ADR-104) — composé uniquement de permissions déjà existantes en lecture seule (`invoice:view`, `export:fec`), aucune capacité d'écriture
- Distinct de la persona institutionnelle DGI nationale (lecture agrégée, jamais un compte, ADR-079/104) — ce mécanisme ne crée jamais d'accès à la DGI elle-même, seulement à un individu invité par l'organisation
- Disponible à tous les paliers dès Freemium (Grille-Offres), cohérent avec `viewer`

Réf : ADR-097, ADR-104

**F15 — Gérer mes clés API en self-service `[SHOULD]`**
En tant que developer_api, je veux générer, révoquer et faire tourner mes clés API, afin d'intégrer facture.gn à mes propres outils sans dépendre du support.
- Permission `api:manage_keys` (ADR-097) — génération, révocation, rotation ; secret affiché une seule fois à la création, jamais ré-affichable ensuite
- Consultation des logs d'appels (méthode, endpoint, statut, horodatage) en lecture seule
- Le webhook sortant marchand (notifier un système tiers qu'une facture est payée) reste hors périmètre — gap distinct, non résolu par cette story (déjà noté ADR-097)

Réf : ADR-097

---

## G. Conformité et sécurité comportementale

**G1 — Détecter un pattern d'anomalie sans seuil monétaire fixe `[MUST]`**
En tant que système, je veux repérer les comportements suspects, afin d'être conforme LBC/FT.
- Aucun seuil minimal, revue humaine systématique

Réf : ADR-032

**G2 — Geler temporairement les plafonds après un reset PIN `[MUST]`**
**G3 — Détecter un pattern de contournement commission `[SHOULD]`** — Réf : ADR-061

### Nouvelle story — auditor sans story malgré sa permission (ADR-097) (17/08)

**G4 — Consulter le journal d'audit de mon organisation `[SHOULD]`**
En tant qu'auditor (ou owner/admin), je veux consulter en lecture seule l'historique des événements de facturation et des changements de permissions, afin de vérifier la conformité sans pouvoir rien modifier.
- Permission `audit:view_log` (ADR-097) — lecture de `invoice_event` (append-only, ADR-015) et de l'historique des changements de rôle/permission
- Aucune action de modification pour ce rôle, aucune exception — lecture seule stricte
- Filtrable par catégorie (facture, paiement, permission) a minima

Réf : ADR-015, ADR-097

---

## H. Modèle économique — tiers, partenaires, facturation

**H1 — Différencier Freemium/Starter/Pro par fonctionnalités `[MUST]`**
En tant que plateforme, je veux proposer des formules qui incitent à l'upgrade sans bloquer l'émission, afin de maximiser l'adoption.
- Aucun plafond de nombre de factures — le volume n'est plus le levier
- REMPLACE l'ancienne H1 (plafond 30 factures/mois)

Réf : Décision modèle économique 25/07/2026

**H2 — Accéder aux formules payantes sans attendre la vérification DGI `[MUST]`** — Réf : ADR-049
**H3 — Facturer l'abonnement Partner au cabinet/CGA `[SHOULD]`** — Réf : ADR-071

**H4 — Calculer et créditer le revenue share cabinet/CGA `[SHOULD]`**
En tant que cabinet ou CGA partenaire, je veux voir combien me rapporte chaque client, afin de mesurer la rentabilité de ma prescription.
- Taux 10%, plafond 5 000 GNF/mois/client
- Encaissable via payment_link_payout (Djomy Payout, fallback Moneroo)

Réf : ADR-071, ADR-078

---

## I. Facturation récurrente, rappels, multi-devise, formes juridiques

**I1 — Générer automatiquement une facture depuis un modèle récurrent `[SHOULD]`**
En tant qu'organisation avec client sous contrat régulier, je veux générer une facture à intervalle défini, afin de ne pas recréer manuellement.
- recurring_invoice_template ne stocke jamais de taux/régime figé

Réf : ADR-056

**I2 — Recevoir un rappel automatique après échéance dépassée `[SHOULD]`**
**I3 — Afficher un montant de référence en devise étrangère `[SHOULD]`** — Réf : ADR-055
**I4 — Configurer une organisation comme association exonérée `[COULD]`** — Réf : ADR-057

---

## J. V1 — lancement national

USSD étendu, vocal multilingue (ADR-051). MTN MoMo/Wave via l'orchestrateur multi-provider. Portail cabinet/CGA complet. Gestionnaire d'activité (business_manager). Badge vérifié Ordre (OCAECG). Export UBL 2.1. Portail administration publique — validation DAF Niveau 2 (ADR-080). Webhook APIP + modèle Partner générique CGA/FODIP/3AE (ADR-077/078). Contact commercial avec 1-2 MFI.

**J1 — Recevoir et valider une facture fournisseur en tant qu'acheteur public `[MUST]`** *(avancée de K1, ADR-098)*
En tant que DAF d'une administration cliente, je veux recevoir les factures certifiées et valider la liquidation, afin de formaliser la reconnaissance de dette et permettre le financement.
- Rôle public_buyer_validator, compte public_buyer_account (ADR-080)
- Validation = événement liquidation_validated (ADR-081, avancé V1 par ADR-098) → validated_by_administration = true

Réf : ADR-080, ADR-081, ADR-098

**J2 — Consulter l'encours fournisseurs certifiés d'une administration `[MUST]`** *(avancée de K2, ADR-098)*
En tant que DAF, je veux voir l'ensemble des factures certifiées adressées à mon entité, afin de piloter mon encours fournisseurs.
- Dashboard public_buyer_account : factures reçues, statut validation, encours total

Réf : ADR-080, ADR-098

---

## K. V2 — Capital Layer et B2G

**K1, K2 — déplacées en J1, J2 (ADR-098)** : la validation DAF (Niveau 2) et la consultation d'encours fournisseurs sont avancées en V1, alignées sur leur événement déclencheur liquidation_validated. Voir section J.

**K3 — Émettre une facture de commande publique via *620# ou PWA `[SHOULD]`**
En tant qu'entrepreneur ayant gagné un marché public, je veux émettre ma facture depuis mon canal habituel, afin de ne pas dépendre d'un smartphone pour facturer l'État.
- Option 6 USSD (condensée, ADR-086) ou parcours PWA complet
- Champ reference_marche optionnel — recopie manuelle de la référence TELEMO, aucune vérification automatique (ADR-090)
- Facture sans référence suit exactement le même parcours qu'une facture avec référence

Réf : ADR-086, ADR-090

**K4 — Choisir un rail de financement après validation DAF `[COULD]`**
En tant qu'entrepreneur avec une facture B2G validée, je veux choisir entre financement immédiat ou attente du Trésor, afin d'être payé selon mes besoins de trésorerie.
- Rail A : avance FINANCIAL_PARTNER, disbursement Djomy Payout ou virement au choix
- Rail B : attente Trésor direct, bank_transfer, 0% commission
- Choix visible uniquement après liquidation_validated — jamais avant
- PWA uniquement (comparaison d'offres), pas sur USSD

Réf : ADR-088, ADR-089

**K5 — Empêcher le double financement d'une même facture `[COULD]`**
En tant que système, je veux bloquer une seconde demande de financement sur une facture déjà financée, afin de protéger les partenaires financiers d'un risque de double nantissement.
- La seule présence de invoice.financed_by_partner_id bloque toute nouvelle demande

Réf : ADR-089

Scoring segmenté regime_fiscal × concentration_clientèle. is_financeable() opérationnel. Portail bancaire avec API dédiée. Anti-double nantissement — désormais concrétisé par financed_by_partner_id (ADR-089), pas seulement mentionné. Sous-clé terrain offline. Portabilité complète.

---

*facture.gn — Backlog — Document confidentiel — 17 août 2026*
