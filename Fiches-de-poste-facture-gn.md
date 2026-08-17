# facture.gn — Fiches de poste

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Descriptions de poste — gouvernance et 4 squads techniques

| Champ | Valeur |
|---|---|
| Date | 17 août 2026 |
| Statut | Référence recrutement — répond au risque G-03 (assistante et mentor non pourvus), résout G-06 (support client, ADR-085), et au dimensionnement du CdC §6 ; ajoute l'Agent commercial terrain, poste distinct du rôle RBAC field_agent (ADR-107) |
| Audience | Sponsor exécutif, Directrice Générale, recrutement, candidats |
| Documents liés | CdC · DAT · Risques-RACI (G-02, G-03, G-06) · Grille-Offres · Registre ADR |
| Dimensionnement cible | 4 squads, 12 à 16 développeurs, 18 mois (MVP → V2), + 2 postes support client, + Agent(s) commercial(aux) terrain (non chiffré) |

> Ce document décrit chaque rôle nécessaire à la construction de facture.gn — gouvernance, puis les quatre squads techniques (Trust, Money, Capital, Platform). Chaque squad suit le même gabarit organisationnel : 1 Tech Lead, 2 à 3 développeurs, 1 QA. Aucun chiffrage salarial n'est inclus ici — le budget reste un poste ouvert (risque G-02), à traiter séparément.

---

## 1. Gouvernance

### 1.1 Sponsor exécutif

**Titulaire actuel : Bou Bakar**

| Dimension | Détail |
|---|---|
| Mission | Décision finale sur la stratégie, le budget, et les relations institutionnelles de premier rang (DGI, Orange, banques partenaires) |
| Responsabilités | Arbitrage budgétaire au-delà de 10M GNF (second signataire conjoint avec la DG) ; validation des changements de scope MVP/V1/V2 ; pilotage des relations DGI et opérateurs Mobile Money ; décisions d'architecture ADR de premier niveau |
| Rattachement | Aucun — autorité finale du projet |
| Critère de succès | Le produit atteint chaque jalon de phasage (MVP T3 2026, V1 T4 2026-T1 2027, agrément PDP visé Q3 2027) sans dérive de positionnement stratégique |

### 1.2 Directrice Générale

**Titulaire : À nommer — poste ouvert, profil déjà identifié**

| Dimension | Détail |
|---|---|
| Mission | Pilotage opérationnel quotidien du projet, validation autonome jusqu'à 10M GNF |
| Responsabilités | Relations avec l'Ordre des Comptables (OCAECG), démarchage des cabinets et CGA (Chantier 3, Chef d'Orchestre) ; supervision du Product Owner ; reporting au Sponsor |
| Rattachement | Sponsor exécutif |
| Critère de succès | Canal de distribution cabinets/CGA opérationnel — 3 LOI signées à J+14, objectif de 90 PME potentielles en pipe |

### 1.3 Product Owner — poste à pourvoir

| Dimension | Détail |
|---|---|
| Mission | Priorisation du backlog produit (77 stories réparties MVP/V1/V2), arbitrage des compromis fonctionnels |
| Responsabilités clés | Maintenir la cohérence entre Backlog, PRD et Registre ADR ; animer la Definition of Done avec les 4 Tech Leads ; représenter la voix utilisateur (10 personas PME + DAF) dans les décisions de priorisation |
| Compétences requises | Expérience produit sur un contexte à forte contrainte d'inclusion numérique (offline-first, USSD, faible littératie) ; capacité à dialoguer avec des profils très techniques (Tech Leads) et très opérationnels (DG, agents terrain) |
| Rattachement | Directrice Générale |
| Périmètre de décision | Priorisation du backlog ; n'approuve pas seul un changement de scope MVP/V1/V2 (Sponsor requis) |

### 1.4 Tech Lead / Architecte transverse — poste à pourvoir

| Dimension | Détail |
|---|---|
| Mission | Garant de la cohérence architecturale globale à travers les 4 squads — c'est la fonction qui a produit et maintient les 106 décisions du Registre ADR |
| Responsabilités clés | Arbitrer les décisions d'architecture transverses (ex. refonte Payment Orchestration du 26/07) ; valider chaque nouvel ADR avant qu'il soit verrouillé ; s'assurer qu'aucune divergence documentaire ne s'installe entre les squads (risque G-04/G-05) |
| Compétences requises | Expérience gérée sur des systèmes distribués multi-services (bounded contexts Trust/Money/Capital/Platform) ; maîtrise des enjeux cryptographiques (Ed25519, SHA-256) suffisante pour arbitrer sans dépendre uniquement du Tech Lead Trust |
| Rattachement | Sponsor exécutif, avec coordination fonctionnelle du Product Owner |
| Périmètre de décision | Toutes les décisions ADR ; seul habilité à approuver une décision qui traverse plusieurs squads |

---

## 2. Squad Trust

**Périmètre : IAM, organisations multi-tenant, facturation core, certification cryptographique, vérification publique.**

### 2.1 Tech Lead Trust

| Dimension | Détail |
|---|---|
| Mission | Garantir l'intégrité cryptographique de chaque facture émise — c'est la couche sur laquelle repose la confiance de tout l'écosystème |
| Responsabilités | Architecture du Cert-Engine (Rust, isolé) ; gestion du cycle de vie des clés (racine, déléguées, révocation) ; conformité au profil de canonicalisation FGN-Canon-v1 |
| Compétences requises | Rust production, cryptographie appliquée (signatures Ed25519, hachage SHA-256), HSM cloud (KMS) |
| Rattachement | Tech Lead / Architecte transverse |

### 2.2 Développeurs Trust (2 à 3 postes)

| Dimension | Détail |
|---|---|
| Mission | Implémenter et maintenir le Cert-Engine, le service IAM, et le mécanisme de vérification publique offline |
| Compétences requises | Rust (Cert-Engine) ou Node/NestJS (API IAM et facturation) selon le poste ; rigueur sur l'immutabilité post-émission (une facture `issued` ne se modifie jamais) |
| Rattachement | Tech Lead Trust |

### 2.3 QA Trust

| Dimension | Détail |
|---|---|
| Mission | Garantir qu'aucune régression ne compromet la chaîne de confiance cryptographique |
| Responsabilités | Tests de non-régression sur le chaînage SHA-256, tests de charge sur le Cert-Engine (cible 12k signatures/s), tests de vérification offline (`verify-gn.js` en mode avion) |
| Rattachement | Tech Lead Trust |

---

## 3. Squad Money

**Périmètre : orchestrateur de paiement (Djomy/Moneroo), USSD *620#, offline & sync engine, commission Money.**

### 3.1 Tech Lead Money

| Dimension | Détail |
|---|---|
| Mission | Garantir que l'argent circule correctement, sans fuite de commission, avec un fallback fiable en cas de panne provider |
| Responsabilités | Architecture de l'orchestrateur `PaymentProvider` (voir Payment-Orchestration) ; pilotage du Chantier 2 (Chef d'Orchestre) — mise en production Djomy, preuve du fallback Moneroo ; arbitrage de la grille tarifaire avec le Product Owner et le Sponsor |
| Compétences requises | Intégration d'API de paiement Mobile Money en Afrique de l'Ouest ; conception de systèmes tolérants aux pannes (circuit breaker, idempotence) ; sensibilité aux contraintes offline (CRDT) |
| Rattachement | Tech Lead / Architecte transverse |
| Critère de succès immédiat | Transaction Djomy live prouvée (J+10) et bascule Moneroo prouvée (J+14) — les deux livrables bloquants du Go/No-Go semaine 4 qui relèvent de ce squad |

### 3.2 Développeurs Money (2 à 3 postes)

| Dimension | Détail |
|---|---|
| Mission | Implémenter l'orchestrateur, l'intégration USSD *620#, et le moteur de synchronisation offline |
| Compétences requises | Node.js, intégration webhook/API tierce, conception d'automates à états (statuts de facture et de paiement), USSD gateway (profondeur de menu, encodage) |
| Rattachement | Tech Lead Money |

### 3.3 QA Money

| Dimension | Détail |
|---|---|
| Mission | Valider chaque scénario de paiement, y compris les cas de bascule provider et de désynchronisation offline |
| Responsabilités | Tests de bascule Djomy→Moneroo sur timeout simulé ; tests de non-fuite de commission (ADR-061) ; tests USSD sur feature phones réels (Tecno T301) |
| Rattachement | Tech Lead Money |

---

## 4. Squad Capital

**Périmètre : catalogue, portail client, comptabilité & cabinet/CGA, analytics/scoring, export & intégrations, B2G/factoring (V2).**

> Ce squad démarre à effectif réduit au MVP (le périmètre Capital Layer est majoritairement V1-V2) et monte en puissance à mesure que le produit avance dans son phasage.

### 4.1 Tech Lead Capital

| Dimension | Détail |
|---|---|
| Mission | Préparer et livrer la couche qui transforme l'historique de facturation certifié en actif finançable |
| Responsabilités | Écosystème cabinet/CGA (professional_practice, mandate, revenue share) ; export FEC conforme OHADA/SYSCOHADA ; portail administration publique (validation B2G, Niveau 2) ; scoring et `is_financeable()` en V2 |
| Compétences requises | Connaissance des normes comptables OHADA/SYSCOHADA ; expérience sur des systèmes multi-tenant avec délégation d'accès (mandats) ; sensibilité aux enjeux réglementaires (KYC, LBC/FT) pour la phase V2 |
| Rattachement | Tech Lead / Architecte transverse |

### 4.2 Développeurs Capital (2 à 3 postes, montée en puissance V1-V2)

| Dimension | Détail |
|---|---|
| Mission | Implémenter le dashboard cabinet/CGA, l'export FEC, et à terme le portail bancaire |
| Compétences requises | Node/NestJS, RLS multi-tenant (PostgreSQL), génération de fichiers d'export normés (FEC, UBL 2.1) |
| Rattachement | Tech Lead Capital |

### 4.3 QA Capital

| Dimension | Détail |
|---|---|
| Mission | Garantir que chaque export FEC est accepté sans rejet par un logiciel comptable réel, et que l'isolation multi-tenant entre organisations mandatées est sans faille |
| Rattachement | Tech Lead Capital |

---

## 5. Squad Platform

**Périmètre : RBAC & audit, notifications, admin & ops, authentification webhooks partenaires, infrastructure transverse.**

### 5.1 Tech Lead Platform

| Dimension | Détail |
|---|---|
| Mission | Garantir la sécurité, la disponibilité et l'auditabilité de l'ensemble de la plateforme, transversalement aux 3 autres squads |
| Responsabilités | RBAC (9 rôles MVP → 19 V1 → 20 V2, 61 permissions MVP → 68 V1 → 69 V2 — ADR-097/098) ; infrastructure Kubernetes multi-AZ ; authentification des webhooks partenaires (API key + HMAC, ADR-082) ; gestion des secrets (Vault) |
| Compétences requises | DevOps/SRE (Kubernetes, observabilité OpenTelemetry) ; conception RBAC à grain fin ; sécurité applicative (gestion de secrets, rotation de clés) |
| Rattachement | Tech Lead / Architecte transverse |

### 5.2 Développeurs Platform (2 à 3 postes)

| Dimension | Détail |
|---|---|
| Mission | Implémenter le RBAC, les notifications (WhatsApp Business API, SMS), et l'outillage d'administration interne |
| Compétences requises | Node/NestJS, intégration d'API de messagerie tierce, conception de systèmes de permissions |
| Rattachement | Tech Lead Platform |

### 5.3 QA Platform / Sécurité

| Dimension | Détail |
|---|---|
| Mission | Revue de sécurité systématique sur tout changement touchant authentification, RBAC, cryptographie, paiements ou données personnelles (Definition of Done, CdC §6) |
| Responsabilités | Tests de pénétration périodiques ; audit sécurité externe préalable au lancement V1 (Q4 2026) ; validation de la conformité LBC/FT (détection comportementale, ADR-032) |
| Rattachement | Tech Lead Platform |

---

## 6. Support client — Chargé de support client (×2)

Poste ouvert lors des travaux sur la Grille des Offres (ADR-085), pour honorer les SLA par sévérité définis pour chaque palier commercial — sans staffing dédié, un SLA Enterprise à 4h critique aurait reposé sur un Tech Lead lâchant son sprint, ce qui n'aurait figuré nulle part dans son rôle. Risque G-06 formalisé et résolu dans le même mouvement.

| Dimension | Détail |
|---|---|
| Mission | Honorer les SLA de réponse par sévérité (Critique/Majeur/Mineur) et par palier commercial, premier niveau de traitement des tickets |
| Responsabilités | Répondre aux tickets Critique/Majeur/Mineur dans les délais définis (ADR-085) ; escalader vers le squad technique concerné si le ticket dépasse la compétence support pure ; utiliser le canal WhatsApp Business API pour le Critique en Enterprise/Custom |
| Compétences requises | Sens du service client, capacité à trier la sévérité réelle d'un ticket, aisance avec les outils de base du produit (assez pour répondre seul aux tickets Mineur/FAQ sans systématiquement escalader) |
| Rattachement | Directrice Générale — volontairement hors des 4 squads techniques, pour ne jamais faire porter le SLA sur un Tech Lead |
| Accès technique | cross_tenant_grant (ADR-029) en mode session temporaire, pour dépanner un compte client sans devenir un accès permanent |
| Effectif | 2 postes dès l'ouverture — un seul n'aurait pas de continuité de service (congés, weekend selon la charge Critique réelle) |

---

## 7. Agent commercial terrain — service commercial et vente (ADR-107)

Poste distinct des rôles RBAC produit (aucun rapport avec `field_agent`, personnel *de la PME elle-même*, ADR-107) — recruté et déployé par facture.gn pour ses activités de vulgarisation et d'acquisition terrain. **Opérationnel dès aujourd'hui**, sans attendre la structuration complète du service auquel il est destiné à être rattaché.

| Dimension | Détail |
|---|---|
| Mission | Inscrire sur le terrain des marchands n'ayant jamais utilisé facture.gn (Parcours 0, Chemin B) — le rendre opérationnel en une session, sans smartphone requis côté marchand |
| Responsabilités | Recueillir le consentement du marchand (`consent_recorded`) ; saisir les informations de l'organisation ; remettre la carte physique portant le code compte (8 caractères Base32, ADR-046) |
| Accès délégué | Délégation par facture.gn lui-même — pas par une PME. 4ᵉ type d'accès délégué du produit (DAT §3.5), création d'organisation (`registration_source = agent_terrain`), jamais un accès à une organisation existante. Jamais de membership persistante pour l'agent |
| Compétences requises | Aisance terrain, langues locales (Sékou : pular, Labé) ; pédagogie pour expliquer un produit numérique à un public à littératie numérique variable |
| Rattachement | Futur service commercial et vente — rattachement organisationnel prévu, pas une condition d'activation ; le poste existe et agit dès maintenant |
| Effectif | Non chiffré à ce stade — dimensionnement du service commercial et vente hors périmètre de ce document |

---

## 8. Postes non-techniques en tension — risque G-03

Le Registre des Risques identifie explicitement deux postes non pourvus comme risque actif (G-03) — statut distinct du support client ci-dessus, qui lui est déjà résolu par l'ouverture des postes :

| Poste | Mission | Impact si non pourvu |
|---|---|---|
| **Assistante** | Support administratif au Sponsor et à la DG — gestion des rendez-vous institutionnels (Orange, cabinets OCAECG, DGI), suivi logistique du Chef d'Orchestre | Surcharge du Sponsor et de la DG sur des tâches à faible valeur ajoutée stratégique, au détriment du pilotage des chantiers critiques |
| **Mentor** | Accompagnement du Product Owner et des Tech Leads dans la structuration du produit et de l'architecture à mesure que l'équipe grandit | Risque de dérive méthodologique non détectée à temps, en particulier sur la discipline documentaire (voir G-04/G-05) |

**Recommandation** : ces deux recrutements devraient être menés en parallèle du recrutement technique, pas après — le risque G-03 est actif dès aujourd'hui, pas seulement à l'échelle.

---

## 9. Synthèse — dimensionnement global

| Squad | Tech Lead | Développeurs | QA | Total |
|---|---|---|---|---|
| Trust | 1 | 2-3 | 1 | 4-5 |
| Money | 1 | 2-3 | 1 | 4-5 |
| Capital | 1 | 2-3 | 1 | 4-5 |
| Platform | 1 | 2-3 | 1 | 4-5 |
| **Total technique** | **4** | **8-12** | **4** | **16-20** |

Auquel s'ajoutent la gouvernance (Sponsor, DG, PO, Tech Lead/Architecte transverse — ce dernier pouvant être l'un des 4 Tech Leads de squad ou un rôle dédié selon la taille finale de l'équipe), les deux postes de support client (rattachés DG, ADR-085), et les deux postes de support en tension (Assistante, Mentor — G-03). Le chiffre de 12 à 16 développeurs mentionné au CdC correspond au périmètre développeurs + QA hors Tech Leads et gouvernance.

---

*facture.gn — Fiches de poste — Document interne recrutement — 17 août 2026*
