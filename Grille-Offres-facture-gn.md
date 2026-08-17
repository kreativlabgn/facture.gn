# facture.gn — Grille des Offres

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Modèle économique et grilles tarifaires — Trust, Money, Capital, Partner

| Champ | Valeur |
|---|---|
| Date | 17 août 2026 |
| Statut | Consolidé — grille Money à 6 paliers dont Starter Plus (ADR-106), matrice de fonctionnalités complète par palier, analytics détaillé avec marge (ADR-084), SLA support par sévérité (ADR-085), financement B2G à deux rails (ADR-088/089), rôles V1 fantômes et renommage tax_controller_readonly (ADR-097/104), grossiste fournisseur signalé non tarifé (ADR-100), customer:flag_public_entity activée (ADR-105), Djomy relevé à 1,4 % et Partner Free ramené à 5 organisations (ADR-106) |
| Audience | Sponsor exécutif, Directrice Générale, Product Owner, équipe commerciale |
| Documents liés | PRD · DAT · Payment-Orchestration · Registre ADR (ADR-058, ADR-071, ADR-074, ADR-083 à ADR-090, ADR-097, ADR-100, ADR-104, ADR-105, ADR-106) · Chef-Orchestre · Fiches-de-poste · ERD |

> Ce document est la référence commerciale unique de facture.gn. Il consolide, en un seul endroit, toutes les grilles tarifaires du produit — PME (Trust/Money), partenaires professionnels (cabinets/CGA), et institutions financières (Capital, V2). Toute communication commerciale externe doit s'appuyer sur ce document et sur lui seul.

---

## 1. Principe fondamental du modèle économique

### 1.1 Le Freemium n'est jamais bloqué sur le volume

Décision structurante actée le 25 juillet 2026, qui remplace l'ancien modèle (plafond de 30 factures/mois en Freemium) : **l'émission et l'encaissement de factures sont gratuits et illimités pour tous, quel que soit le palier commercial.** La différenciation entre Freemium, Starter et Pro se fait exclusivement par les **fonctionnalités** débloquées — jamais par un plafond de nombre de factures.

Cette décision est structurante pour la thèse produit : facture.gn ne gagne de l'argent que lorsqu'une facture est **payée**, pas lorsqu'elle est **émise**. Bloquer l'émission reviendrait à décourager l'usage même qui, in fine, génère le revenu.

### 1.2 Trois couches, trois moteurs de revenu

| Couche | Moteur de revenu | Qui paie |
|---|---|---|
| **Trust** | Abonnement — fonctionnalités premium (récurrence, multi-succursale, RBAC étendu, branding) | La PME émettrice |
| **Money** | Commission sur encaissement non-cash | Le payeur (client de la PME), jamais le marchand |
| **Capital** | Commission d'apport d'affaires sur montant financé (V2) | La banque ou l'institution de microfinance partenaire |

### 1.3 Alignement d'intérêts

facture.gn ne gagne que quand la PME est payée. Le cabinet ou le CGA ne gagne que quand ses clients mandatés encaissent en non-cash. La banque ne finance que des créances certifiées et vérifiées. Cette chaîne d'alignement fait du **taux d'encaissement** (North Star metric, cible > 95 %) l'indicateur qui rassemble tous les acteurs de l'écosystème autour du même objectif.

### 1.4 Mitigation du volume illimité — convertir le cash plutôt que le plafonner (ADR-106)

Le volume illimité de §1.1 n'est pas reconsidéré — la grille structurante du 25/07 a déjà été testée et actée, et la revenir dessus une seconde fois coûterait plus cher qu'un simple ajustement de teinte de fond (comparer avec ADR-102/103). Le vrai trou n'est pas le volume de factures, c'est le volume payé en cash (0 % de commission, par design, ADR-016) : une organisation Freemium à très gros volume mais 100 % cash ne rapporte structurellement rien, indéfiniment.

Le levier existe déjà dans le document sans avoir jamais été activé comme mécanisme Freemium spécifique : le **taux d'encaissement** (§1.3). Seuil de déclenchement : **> 60 % des paiements en cash sur 30 jours glissants**. Action : une relance in-app vers le lien de paiement (« X % de vos paiements sont en cash — un lien de paiement vous fait encaisser plus vite ») — jamais un blocage d'émission, jamais un plafond de volume. Ce mécanisme convertit du volume non-monétisé en volume monétisé sans toucher à la promesse de §1.1.

---

## 2. Grille Trust — fonctionnalités par palier

La matrice ci-dessous est la référence complète, construite pour donner un contenu concret à la différenciation par fonctionnalités (§1.1) — jusqu'ici seulement affirmée en principe, jamais détaillée poste par poste.

| Catégorie | Freemium | Starter | Starter Plus | Pro | Enterprise | Custom |
|---|---|---|---|---|---|---|
| Prix mensuel | 0 GNF | 100 000 GNF | 250 000 GNF | 500 000 GNF | 750 000 GNF | 1 500 000 GNF |
| Émission/encaissement | Illimité | Illimité | Illimité | Illimité | Illimité | Illimité |
| Export FEC | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Succursales | 1 | 2 | 5 | Illimité | Illimité | Illimité |
| Collaborateurs inclus | 1 | 4 | 7 | 10 | Illimité | Négocié |
| Rôles de base (9, MVP) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| viewer, tax_controller_readonly | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| inventory_manager | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| business_manager, approver, auditor | — | — | — | ✓ | ✓ | ✓ |
| developer_api / accès API | — | — | — | ✓ | ✓ | ✓ |
| Gestion client avancée (V1 — merge doublons, credit_limit) | — | — | — | ✓ *(nécessite approver)* | ✓ | ✓ |
| Marquer un client entité publique (B2G, ADR-105) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Récurrence automatique | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rappels auto (WhatsApp/SMS) | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Branding facture (logo/couleurs) | — | Logo seul | Logo seul | Complet | Complet + multi-marque | Complet |
| Export UBL 2.1 | — | — | — | ✓ | ✓ | ✓ |
| Analytics | Basique | Basique | Basique | Avancé (+ marge) | Sur mesure | Sur mesure |
| Support | FAQ/communauté | Email | Email | Email prioritaire | Dédié + SLA | Dédié + SLA négocié |

### 2.1 Notes de lecture sur les seuils

- **Export FEC universel dès Freemium** : c'est une obligation de conformité comptable, jamais un luxe à monétiser — le gater aurait puni les PME les plus fragiles face à la DGI, à rebours du positionnement « bénéficiaire structurel » (ADR-079).
- **Succursales et collaborateurs** : progression 1 → 2 → 5 → illimité (succursales) et 1 → 4 → 7 → 10 → illimité (collaborateurs) — au-delà de Pro, plus aucune raison de brider un compte qui a déjà démontré son volume.
- **Starter Plus (ADR-106)** existe pour combler un saut tarifaire réel : de Starter (2 succursales) à Pro (illimité), une PME à 3-5 succursales n'avait aucune option intermédiaire. Starter Plus sépare pour la première fois deux axes jusqu'ici confondus dans une seule progression : l'**échelle** (succursales, collaborateurs) et la **sophistication** (RBAC avancé, analytics, API). Starter Plus ouvre uniquement le premier axe — aucune fonctionnalité de sophistication n'y est débloquée, elle reste réservée à Pro et au-delà.
- **RBAC étendu réservé à partir de Pro** ne s'applique qu'aux rôles qui font réellement fonctionner une entreprise à un niveau de sophistication croissant (pilotage, workflow de validation, audit) — jamais aux rôles de conformité ou d'accès simple (viewer, tax_controller_readonly), ouverts partout dès Freemium par cohérence avec le positionnement DGI. Deux rôles du catalogue V1 (support, sysadmin) n'apparaissent volontairement pas dans cette grille : ce sont des rôles internes facture.gn, jamais attribuables par une PME cliente à son propre personnel, quel que soit son palier.
- **Gestion client avancée** n'existe qu'à partir de Pro parce qu'elle dépend structurellement du rôle `approver` (ADR-083) — sans lui, la permission `customer:manage_credit_limit` n'aurait personne pour l'exercer en Starter ou Freemium.
- **Marquer un client entité publique** (`customer:flag_public_entity`, réservée admin/owner, ADR-083) ne dépend d'aucun rôle additionnel comme `approver` — ouverte partout dès Freemium, même logique que l'export FEC : une PME desservant une administration ne doit jamais être empêchée d'entrer dans le circuit de validation DAF (Niveau 2, ADR-098) par une barrière de palier commercial. Déclarée V1 depuis ADR-083 mais restée inerte jusqu'à ADR-098/105 — voir Registre-ADR, Parties 13 et 20.

---

## 3. Analytics — définition par palier

Section détaillée séparément de la grille principale, parce que « Basique / Avancé / Sur mesure » ne veut rien dire de concret sans contenu précis.

### 3.1 Basique (Freemium, Starter)

- Taux d'encaissement (North Star metric)
- CA encaissé du mois / cumulé
- Compteur de factures par statut (payée / en attente / partielle / annulée)
- Répartition cash vs non-cash (simple)
- Liste des factures en retard > 30 jours
- Vue fixe, pas de sélection de période personnalisée

### 3.2 Avancé (Pro et au-delà)

- Par produit : chiffre d'affaires **et marge** (ADR-084 — voir §3.3)
- Par client : top clients, clients à risque (running_balance élevé, retards répétés)
- Par succursale : CA par branch — cohérent avec les succursales illimitées dès Pro
- Délai moyen de paiement (issued_at → collected_at)
- Répartition fine par mode de paiement (Orange Money / MTN MoMo / carte / cash / virement)
- Sélecteur de période personnalisé + export CSV
- Tendances (évolution mois/mois du taux d'encaissement)

### 3.3 Marge produit — cost_price et son snapshot (ADR-084)

`PRODUCT.cost_price` (nullable, centimes GNF) porte le coût d'achat déclaré par la PME — nullable pour ne jamais bloquer la création d'un produit avant que son coût soit connu. `INVOICE_LINE.cost_price_at_time` capture ce coût **au moment de la facturation**, jamais recalculé après coup : si le coût changeait rétroactivement à chaque mise à jour de `cost_price`, tous les rapports de marge passés se déformeraient silencieusement à chaque changement de tarif fournisseur — le même problème, déjà résolu ailleurs, que `tax_rate_bps`.

La marge est une donnée commercialement sensible : la permission `analytics:view_margin` (V1) la réserve à owner/admin/business_manager — un `cashier` ou `field_agent` n'y a jamais accès, même dans une organisation dont le palier ouvre par ailleurs les analytics avancés. Le gate de permission est donc plus restrictif que le simple gate de palier.

### 3.4 Sur mesure (Enterprise, Custom)

- Accès API aux données analytics, pas seulement l'interface
- Connecteur BI Metabase (voir §3.5)
- Rapports automatisés envoyés par email à fréquence définie
- Dashboards personnalisés sur devis

### 3.5 Infrastructure BI — instance Metabase mutualisée

Une seule instance Metabase, partagée, avec des collections scopées par organisation via le même mécanisme RLS déjà utilisé partout ailleurs (`SET app.current_company`) — jamais une instance dédiée par client Enterprise. Cette instance est la même que celle déjà utilisée pour les dashboards lecture seule de FODIP et 3AE (ADR-078), pas un outil séparé.

Alternatives écartées consciemment : Superset (plus puissant mais plus lourd à opérer, aucune équipe data dédiée pour le maintenir) ; Grafana (déjà réservé à l'observabilité infrastructure — mauvais outil pour du reporting business, et l'utiliser aussi pour l'analytics client aurait mélangé deux audiences très différentes sur le même outil).

---

## 4. Grille Money — commission sur encaissement non-cash

### 4.1 La grille à 6 paliers, dont Starter Plus (ADR-074, révisée par ADR-106 le 17 août)

Cash = 0 % de commission, systématiquement — aucun frais opérateur, aucune commission facture.gn. Tout encaissement non-cash (Mobile Money, carte) transite obligatoirement par un lien de paiement hébergé, orchestré par Djomy (primary) et Moneroo (fallback) — voir Payment-Orchestration pour le détail technique. Djomy a relevé ses frais gateway de 1 % à **1,4 %** (ADR-106) — traité ici en taux flat par simplification, la grille Djomy réelle étant dégressive mais non encore modélisée dans ce document.

| Tier | Abonnement | Commission affichée | Commission cible (négo) | Cap par transaction | Frais Djomy | **Total payeur** | Exemple sur 600 000 GNF |
|---|---|---|---|---|---|---|---|
| **Freemium** | 0 GNF/mois | 2,1 % | 1,6 % | 50 000 GNF | 1,4 % | **3,5 % — 21 000 GNF** | 12 600 GNF de commission facture.gn |
| **Starter** | 100 000 GNF/mois | 1,6 % | 1,1 % | 50 000 GNF | 1,4 % | **3,0 % — 18 000 GNF** | 9 600 GNF de commission facture.gn |
| **Starter Plus** | 250 000 GNF/mois | 1,35 % | 0,9 % | 60 000 GNF | 1,4 % | **2,75 % — 16 500 GNF** | 8 100 GNF de commission facture.gn |
| **Pro** 🟡 *Populaire* | 500 000 GNF/mois | 1,1 % | 0,6 % | 75 000 GNF | 1,4 % | **2,5 % — 15 000 GNF** | 6 600 GNF de commission facture.gn |
| **Enterprise** | 750 000 GNF/mois | 0,8 % | 0,6 % | 100 000 GNF | 1,4 % | **2,2 % — 13 200 GNF** | 4 800 GNF de commission facture.gn |
| **Custom volume** | 1 500 000 GNF/mois | 0,6 % | 0,4 % *(plancher)* | 150 000 GNF | 1,4 % | **2,0 % — 12 000 GNF** | 3 600 GNF de commission facture.gn |

**Total payeur préservé malgré la hausse Djomy** : la commission affichée facture.gn absorbe intégralement les +0,4 pt de frais Djomy sur Freemium/Starter/Pro/Enterprise/Custom — le total payeur de chaque palier existant reste identique à la grille du 26/07, pour ne jamais surprendre un payeur avec un prix qui bouge du fait d'un fournisseur tiers.

### 4.2 Lecture de la grille

- **Commission affichée** : le taux par défaut, appliqué à toute organisation qui n'a pas négocié individuellement.
- **Commission cible (négo)** : le taux plancher vers lequel la Direction Générale ou le Sponsor peuvent négocier, au cas par cas, pour des comptes stratégiques ou à fort volume. Ce n'est jamais un taux public.
- **Cap** : le plafond de commission par transaction, quel que soit le montant de la facture — protège les gros montants d'une commission proportionnellement excessive.
- **Total payeur** : ce que le client final (le payeur) voit et paie réellement — commission affichée + 1,4 % de frais gateway Djomy (ADR-106, relevé depuis 1 %). Le marchand, lui, reçoit systématiquement le montant certifié intégral de sa facture (ADR-059, ADR-074) : **le frais n'est jamais déduit de ce que le marchand encaisse.**

### 4.3 Ce qui change par rapport à l'ancienne grille

| | Ancienne grille (jusqu'au 25/07) | Nouvelle grille (26/07) |
|---|---|---|
| Nombre de paliers | 3 (Freemium, Starter, Pro) | 5 (+ Enterprise, Custom volume) |
| Structure du taux | Taux unique par palier | Double taux : affiché / cible négo |
| Cap | Uniforme à 50 000 GNF | Différencié par palier (50k à 150k) |
| Money net projeté (M18, 10k orgs) | 999M GNF/mois | **1 660M GNF/mois (+66 %)** |

### 4.4 Paramètres de configuration versionnés (ADR-058)

Aucun de ces taux n'est en dur dans le code — chaque valeur vit en table de configuration versionnée, ajustable sans refactoring, chaque modification étant elle-même un événement auditable.

| Paramètre | Valeur actuelle |
|---|---|
| `commission_freemium_displayed_bps` / `target_bps` | 210 (2,1 %) / 160 (1,6 %) |
| `commission_starter_displayed_bps` / `target_bps` | 160 (1,6 %) / 110 (1,1 %) |
| `commission_starter_plus_displayed_bps` / `target_bps` | 135 (1,35 %) / 90 (0,9 %) |
| `commission_pro_displayed_bps` / `target_bps` | 110 (1,1 %) / 60 (0,6 %) |
| `commission_enterprise_displayed_bps` / `target_bps` | 80 (0,8 %) / 60 (0,6 %) |
| `commission_custom_displayed_bps` / `target_bps` | 60 (0,6 %) / 40 (0,4 % floor) |
| `commission_cap_freemium_gnf` / `starter_gnf` | 50 000 GNF chacun |
| `commission_cap_starter_plus_gnf` | 60 000 GNF |
| `commission_cap_pro_gnf` | 75 000 GNF |
| `commission_cap_enterprise_gnf` | 100 000 GNF |
| `commission_cap_custom_gnf` | 150 000 GNF |
| `gateway_fee_djomy_bps` | 140 (1,4 %) — relevé depuis 100 (1 %), ADR-106 |

---

## 5. Grille Partner — cabinets comptables et CGA

### 5.1 Abonnement Partner

Un cabinet comptable, un gestionnaire d'activité, ou un Centre de Gestion Agréé (CGA, depuis le 26/07 — voir ADR-078) souscrit à l'un de ces quatre paliers, indépendamment de la grille Money de ses clients mandatés.

| Tier partenaire | Prix | Inclus |
|---|---|---|
| **Partner Free** | 0 GNF/mois | Dashboard multi-organisations (≤ 5 entreprises, ADR-106 — abaissé depuis 10), export FEC |
| **Partner Starter** | ~500 000 GNF/mois | ≤ 50 entreprises, statistiques, FEC consolidé |
| **Partner Pro** | ~1 500 000 GNF/mois | Illimité, branding personnalisé, alertes de conformité, API comptable |
| **Partner Institutionnel** | Sur devis | Co-branding, reporting personnalisé, support dédié |

### 5.2 Revenue share — commission d'apport (ADR-071)

Le cabinet ou le CGA touche **10 % de la commission facture.gn** générée par ses clients mandatés (paramètre config `revenue_share_rate_bps`), plafonné à **5 000 GNF/mois par client** (`revenue_share_cap_per_client_gnf`). Calcul quotidien, crédit mensuel.

- **Mode de versement** : encaissable via `payment_link_payout` (Djomy Payout, fallback Moneroo), ou déductible directement de l'abonnement Partner du cabinet.
- **CGA** : suit exactement le même mécanisme, taux et plafond identiques — aucune grille distincte n'a été créée pour ce 4e type de `professional_practice` (ADR-078), afin de ne pas complexifier inutilement le modèle.

### 5.3 Exemple chiffré

Un cabinet Partner Pro avec 40 clients actifs, chacun générant en moyenne 8 000 GNF de commission Money mensuelle : revenue share = 10 % × 8 000 = 800 GNF/client/mois (sous le plafond de 5 000 GNF), soit 32 000 GNF/mois pour l'ensemble du portefeuille — à comparer aux 1 500 000 GNF d'abonnement. Le revenue share seul ne finance pas l'abonnement Partner Pro ; il s'agit d'un complément d'alignement d'intérêt, pas d'un centre de profit autonome pour le cabinet à ce stade de volume. La proposition de valeur du Partner Pro repose donc avant tout sur le gain de temps opérationnel (FEC consolidé, alertes, API), le revenue share n'étant qu'un bonus.

### 5.4 Graduation Partner Free → Partner Starter (ADR-106)

Le cap Partner Free (§5.1, 10 → 5 organisations) ne suffit pas seul : un mur dur unique laisse un cabinet découvrir la limite au pire moment, et rate les cabinets à peu de clients mais gros volume. Trois signaux, pas un seul :

1. **Nudge à 4/5** — bandeau in-app dès la 4ᵉ organisation mandatée, avant tout blocage.
2. **Mur dur à la 6ᵉ** — impossible d'accepter un nouveau mandat sans passer Partner Starter (≤ 50 organisations, ~500 000 GNF/mois).
3. **Signal de valeur, indépendant du compte d'organisations** — un revenue share cumulé (§5.2) supérieur à 20 000 GNF/mois déclenche le même nudge, même sous 5 organisations : un cabinet à 3-4 clients mais fort volume de commission Money est aussi mûr pour l'upgrade qu'un cabinet à 5 clients.

---

## 6. Grille Capital — apporteur d'affaires (V2)

Hors périmètre MVP et V1. facture.gn perçoit une **commission versée par la banque ou l'institution de microfinance partenaire**, calculée sur le montant effectivement financé — jamais une commission versée par la PME emprunteuse. facture.gn certifie l'authenticité et l'historique de la créance ; il ne garantit jamais la solvabilité et n'est en aucun cas prêteur.

Trois niveaux d'intégration, correspondant à trois profondeurs d'engagement commercial avec les partenaires financiers :

| Niveau | Description | Phase |
|---|---|---|
| Vérification passive | Consultation gratuite via `verify.facture.gn`, zéro intégration technique | Dès le MVP |
| Portail bancaire | API dédiée, consultation de l'historique certifié | V1-V2 |
| Scoring et factoring intégré | Anti-double nantissement, commission d'apport | V2 |

### 6.1 Financement B2G — deux rails, mécanisme concret (ADR-088/089)

Une facture B2G validée (liquidation DAF) ouvre deux chemins, toujours disponibles en parallèle :

- **Rail A — financement** : un `FINANCIAL_PARTNER` (banque ou MFI) avance le montant immédiatement, disbursement via Djomy Payout (Mobile Money) ou virement au choix de la PME. Le Trésor rembourse ensuite la banque — jamais la PME — par cession de créance.
- **Rail B — attente directe** : la PME attend le virement Trésor sans financement, 0% commission.

Frais de disbursement (`payout_fee_djomy_bps`) portés par la banque, jamais déduits de ce que la PME reçoit — même logique que le principe déjà tenu pour la commission Money (le payeur, ou ici le partenaire financier, porte le coût, jamais le bénéficiaire final).

**Partenaires initiaux vérifiés** : Ecobank, UBA (banques), COFINA, Akiba Finance (MFI, agréée BCRG, positionnement inclusion financière PME/femmes).

**Anti-double financement** : la seule présence de `INVOICE.financed_by_partner_id` bloque une seconde avance sur la même facture — mécanisme désormais concret, remplaçant la mention générique « anti-double nantissement » portée depuis plusieurs documents sans jamais être définie.

### 6.2 Grossiste fournisseur — crédit privé (ADR-100)

`FINANCIAL_PARTNER.type` reçoit une troisième valeur, `fournisseur_crediteur`, pour les acteurs commerciaux non agréés (grossistes imposant facture.gn à leur réseau de boutiques clientes) qui octroient des avances sur la base du score de confiance transactionnelle (ADR-093) de la boutique — jamais sur son propre `credit_limit` de fournisseur, qui reste un objet distinct (délai de paiement fournisseur ≠ avance de trésorerie). Condition stricte : la boutique doit accorder un mandat explicite (même mécanisme que le mandat cabinet, ADR-069) avant que son score de confiance — par défaut interne et non exposé — devienne visible du grossiste.

**Non tarifé, non construit à ce stade** : contrairement au Rail A/B (§6.1), ce mécanisme n'a ni grille tarifaire ni date de livraison — le point 3/4 d'ADR-100 le classe explicitement V2 Capital Layer, et son point 5 signale un **risque réglementaire non tranché (R-16, Registre des Risques)** : un grossiste n'est pas un établissement de crédit agréé, contrairement aux MFI déjà partenaires (Akiba Finance, agréée BCRG). Faciliter du crédit privé à grande échelle par un acteur non agréé pourrait constituer une activité de crédit non réglementée au sens du droit guinéen — **à qualifier avec un conseil juridique avant toute construction**, y compris commerciale (aucune grille à publier avant cette qualification).

La relation commerciale ordinaire (grossiste → boutique comme `CUSTOMER`, délai de paiement fournisseur) est distincte et déjà intégralement couverte par l'existant — voir E9 (Backlog) pour l'import client en masse, seul gap réel de ce côté.

---

## 7. Support client — SLA par sévérité (ADR-085)

Un chiffre de délai unique par palier serait une fiction : un ticket qui bloque tout encaissement et une question cosmétique n'ont rien à voir. Le SLA est donc structuré par sévérité, croisée avec le palier commercial.

| Sévérité | Exemple | Freemium/Starter | Pro | Enterprise | Custom |
|---|---|---|---|---|---|
| **Critique** — encaissement/émission bloqué | Lien de paiement down, USSD inopérant | 48h ouvrées | 24h ouvrées | 4h ouvrées (WhatsApp) | Négocié, plancher 2h |
| **Majeur** — fonctionnalité dégradée | Export FEC en erreur, mandat qui ne s'accepte pas | 72h ouvrées | 48h ouvrées | 24h ouvrées | Négocié |
| **Mineur** — question, cosmétique | Comment faire X, demande d'évolution | Best effort (FAQ/communauté) | 5j ouvrés | 48h ouvrées | Négocié |

### 7.1 Ce que le SLA engage — et ce qu'il n'engage pas

Le SLA porte sur le **temps de réponse**, jamais sur le temps de résolution — un bug cryptographique complexe (Squad Trust) ne se résout pas en 4h même si le ticket est pris en charge dans ce délai. Les seuils ci-dessus sont des cibles initiales en paramètre config versionné (ADR-058), ajustables sans refactoring si l'usage réel montre qu'ils sont trop serrés ou trop larges — pas des promesses gravées dans le code.

### 7.2 Canal et staffing

WhatsApp Business API pour le Critique en Enterprise/Custom — réutilise l'intégration déjà en place pour les rappels et liens de paiement, aucune nouvelle brique technique. Deux postes « Chargé de support client » (Fiches de poste) rattachés à la Directrice Générale honorent ces délais — un SLA promis sans staffing dédié était un risque (G-06), désormais résolu par l'ouverture de ces postes plutôt que par une promesse commerciale sans contrepartie opérationnelle.

---

## 8. Projection financière consolidée

### 8.1 Money Layer — M18, 10 000 organisations

**Projection caduque depuis ADR-106 (17/08), non recalculée.** Les chiffres ci-dessous datent de la grille du 26/07 (5 paliers, commission affichée 2,5→1,0 %) — la révision à 6 paliers et les nouveaux taux (2,1→0,6 %, Djomy absorbé) les rendent obsolètes. Un nouveau chiffrage exige des hypothèses de répartition des organisations par palier, notamment sur l'adoption de Starter Plus, qui n'existent pas encore — signalé comme travail restant plutôt que ré-estimé au jugé.

| Indicateur | Valeur (grille du 26/07, obsolète) |
|---|---|
| Money net (commission facture.gn) | 1 660M GNF/mois |
| Revenu total | 2 080M GNF/mois ≈ 241 000 USD/mois |
| Variation vs ancienne grille | +66 % |

### 8.2 Facteur d'ajustement en attente — Deal Orange

Le deal envisagé avec Orange (0,5 % de commission Money cédée contre USSD gratuit à l'émission) impacterait potentiellement ce chiffre à la baisse sur le segment Freemium USSD spécifiquement — de l'ordre de 360M GNF/mois cédés, à mettre en regard des 875M GNF/mois de commission Money attendue sur ce même segment une fois débloqué. Ce facteur reste en attente de chiffrage réel (voir Chef-Orchestre, Chantier 1, tâche o2) et n'est donc **pas encore intégré** à la projection M18 ci-dessus.

---

## 9. Gouvernance de la grille tarifaire

| Décision | Niveau d'approbation requis |
|---|---|
| Ajustement d'un taux affiché ou cible dans les bornes déjà approuvées | Product Owner, avec information au Sponsor |
| Négociation d'un taux Custom volume individuel | Directrice Générale |
| Refonte structurelle de la grille (nombre de paliers, structure du taux) | Sponsor exécutif, comme lors de la refonte du 26/07 |
| Tout accord commercial impactant durablement la grille (ex. deal Orange) | Sponsor exécutif + Directrice Générale conjointement |

Aucun taux ne doit jamais être modifié directement en base de données sans passer par la table de configuration versionnée (ADR-058) — toute modification y est un événement auditable, jamais un correctif silencieux.

---

*facture.gn — Grille des Offres — Document confidentiel — 17 août 2026*
