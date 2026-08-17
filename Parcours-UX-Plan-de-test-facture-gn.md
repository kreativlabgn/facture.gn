# facture.gn — Parcours UX & Plan de test

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Parcours utilisateurs détaillés et stratégie de validation

| Champ | Valeur |
|---|---|
| Date | 17 août 2026 |
| Statut | Consolidé — Parcours 0, orchestrateur Djomy/Moneroo, écosystème cabinet/CGA, gestion client avancée/analytics/support (ADR-083/084/085), multi-numéros, Commande Publique/TELEMO, financement B2G (ADR-086 à 090), rôles V1 sans parcours dédié — contrôleur fiscal, stock, audit, clés API (ADR-097/104/105), Chemin B corrigé — Agent commercial terrain distinct de field_agent (ADR-107) |
| Audience | Product Owner, UX, QA, Tech Leads |
| Documents liés | PRD · CdC (§8 critères de réception) · Backlog · Grille-Offres · Fiches-de-poste · Charte Graphique · Registre ADR |

> Ce document a deux fonctions : décrire, persona par persona, le chemin réel que suit chaque utilisateur dans le produit ; et définir comment chacun de ces chemins est validé avant mise en production. Les parcours ne sont pas des scénarios illustratifs — chaque étape correspond à un endpoint, un événement `invoice_event`, ou un écran identifié dans le Backlog.

---

## 1. Parcours 0 — Onboarding

**Nouveau parcours, ajouté à la consolidation du 25/07 — le point d'entrée de tous les autres parcours.**

Avant de pouvoir suivre un parcours métier (émettre, encaisser, mandater), toute organisation passe par l'un de deux chemins d'inscription. Le choix du chemin dépend de l'accès de la personne à un smartphone et de son autonomie numérique — jamais de son niveau socio-économique supposé.

### 1.1 Chemin A — Self-service PWA

**Personas typiques : Aissatou (boutique connectée), Aminata (freelance)**

1. Ouverture de la PWA facture.gn, sélection de la langue (français, pular, malinké, soussou).
2. Saisie du nom d'organisation, régime fiscal déclaré, NIF et eTax — **les deux optionnels** (ADR-035, story B4). L'organisation est créée en statut `unverified`, palier de vélocité T0.
3. Génération de la clé racine Ed25519 côté serveur (HSM cloud) — invisible pour l'utilisateur.
4. Première facture émise en moins de 5 minutes depuis l'ouverture de l'app (TTV — Time To Value, critère de réception MVP).

### 1.2 Chemin B — Assisté terrain

**Personas : Sékou (Agent commercial terrain, facture.gn) inscrit Mariama (marché, feature phone) ou Fanta (revendeuse en ligne, souvent non enregistrée)**

Sékou n'est **pas** le rôle RBAC `field_agent` — celui-ci désigne le personnel *de la PME elle-même* (assiste ses ventes une fois l'organisation déjà créée, ADR-045). Sékou est recruté et déployé par facture.gn pour ses activités de vulgarisation et d'acquisition terrain (ADR-107) ; il n'a aucun lien avec une organisation existante au moment où il agit, puisqu'elle n'existe pas encore.

1. Sékou (Agent commercial terrain) initie une inscription — accès délégué par facture.gn lui-même, pas par une PME (4ᵉ type d'accès délégué, DAT §3.5, ADR-107). Jamais de membership persistante créée pour lui.
2. Il saisit les informations de l'organisation pour le compte du marchand, avec consentement enregistré (`consent_recorded`). `ORGANIZATION.registration_source = agent_terrain`.
3. Remise d'une carte physique portant le code compte (8 caractères Base32) — nécessaire pour toute connexion ultérieure depuis un téléphone qui n'est pas reconnu comme celui du propriétaire (ADR-046).
4. Le marchand est immédiatement opérationnel, y compris pour émettre depuis *620# sans jamais avoir touché un smartphone.

### 1.3 Ce que ce parcours ne fait jamais

Aucun chemin d'inscription ne bloque l'accès aux fonctionnalités de base en attendant une vérification DGI (ADR-036, ADR-049) — la vérification NIF+eTax est un accélérateur de palier de vélocité, jamais une porte d'entrée.

---

## 2. Parcours Aissatou — Émission et encaissement PWA

**Objectif : facturer une vente de marchandise avec paiement Mobile Money.**

1. Depuis la PWA, création d'une facture : sélection du client (ou facture anonyme si absent), ajout des lignes de produit.
2. Émission (`draft → issued`) : signature Ed25519, attribution du `number` et du `certification_id`, génération automatique du lien de paiement.
3. Le lien est envoyé au client par WhatsApp ou SMS.
4. Le client clique, choisit Orange Money — le paiement est routé vers Djomy (primary). En cas d'indisponibilité, bascule automatique et invisible vers Moneroo.
5. Webhook reçu, `invoice.status → paid`, notification à Aissatou.

**Points de test critiques** : génération du lien en moins de 3 secondes après émission ; affichage exact des frais de transaction au client avant confirmation (ADR-067, ADR-074).

---

## 3. Parcours Mamadou / CGA — comptable ou CGA multi-entreprises

**Objectif : consulter les factures de plusieurs clients mandatés et exporter un FEC consolidé.**

1. Mamadou crée sa `professional_practice` (type `cabinet_comptable`) ou, pour un Centre de Gestion Agréé, type `cga` (ADR-078).
2. Il demande un mandat sur l'organisation d'un client — `mandate_requested`.
3. Le client accepte via la PWA ou *620# (option 5.3 + PIN) — `mandate_granted`. Le mandat est accordé à la practice, jamais à Mamadou personnellement.
4. Depuis son dashboard, Mamadou switch entre les organisations mandatées en moins d'une seconde.
5. Il exporte un FEC consolidé, conforme OHADA/SYSCOHADA, sans rejet.
6. Un collaborateur de son cabinet qui quitte perd l'accès automatiquement — le mandat reste attaché à la practice, pas à l'individu (ADR-069).

**Points de test critiques** : switch < 1 seconde (démontré en Chef d'Orchestre, tâche c4) ; export FEC accepté par un logiciel comptable réel sans rejet (critère de réception MVP).

---

## 4. Parcours Mariama — émission via *620#

**Objectif : facturer depuis un feature phone, sans smartphone, sans littératie numérique avancée.**

1. Composition de *620#, menu canonique affiché : 1. Payer une facture · 2. Vérifier un reçu · 3. Mes factures · 4. Émettre une facture · 5. Gérer mon compte.
2. Option 4, saisie du montant et du client (ou anonyme), confirmation par PIN.
3. Signature serveur immédiate — Mariama ne détient jamais la clé cryptographique, seulement le PIN qui autorise son usage.
4. SMS de confirmation avec le numéro de facture.

**Points de test critiques** : séquence complète en moins de 90 secondes (critère de réception MVP, chronométré avec Mariama elle-même) ; idempotence stricte en cas de coupure réseau en cours de session (ADR-044).

---

## 5. Parcours Djénabou — arrhes et no-show hôtelier

**Objectif : sécuriser une réservation par des arrhes, avec forfait automatique en cas de no-show.**

1. Création d'une proforma (`document_type = proforma`) pour la réservation.
2. Encaissement d'arrhes (`deposit_type = arrhes`) — traitement TVA distinct de l'acompte (ADR-034).
3. Si le client se présente : la proforma est convertie en facture définitive, le régime fiscal recalculé au moment de la conversion.
4. Si no-show : le forfait s'applique automatiquement (`cancellation_indemnity` ou `no_show_forfeited` selon le cas), sans intervention manuelle de Djénabou.

**Point de test critique** : la distinction arrhes/acompte doit produire un traitement TVA différent et vérifiable dans l'export FEC.

---

## 6. Parcours Ibrahima — livraison et facturation offline

**Objectif : émettre et faire signer une facture en zone sans réseau, à Coyah.**

1. Émission de la facture en mode offline — la PWA fonctionne jusqu'à 48 heures sans connexion.
2. Signature et chaînage effectués localement puis synchronisés dès le retour du réseau (CRDT monotone sur les statuts).
3. Aucune perte de données, aucun doublon créé au moment de la resynchronisation.

**Point de test critique** : critère de réception MVP — 0 facture perdue sur 1000 tests de coupure réseau simulée ; démonstration terrain réelle à Coyah après 48h sans réseau.

---

## 7. Parcours Aminata — devis et conversion

**Objectif : envoyer un devis à un client, puis le convertir en facture une fois accepté.**

1. Création d'un devis (`document_type = quote`) — aucun paiement possible tant que le document reste un devis.
2. Envoi du devis au client, avec date de validité (`quote_valid_until`).
3. Acceptation → conversion en nouvelle facture `draft`, jamais une modification du devis original, qui passe à `converted`.
4. Émission normale de la nouvelle facture.

**Point de test critique** : un devis expiré (`expired`) ne doit jamais pouvoir être converti — seule une nouvelle demande de devis est possible.

---

## 8. Parcours Fanta — inscription non enregistrée, e-commerce, et livraison cash

**Objectif : démontrer que l'absence de NIF/eTax à l'inscription ne bloque jamais l'usage (ADR-049, retrait du gate DGI), et que la vente en ligne coexiste avec l'encaissement à la livraison.**

1. Inscription via Chemin B (assisté) ou Chemin A, sans NIF ni eTax.
2. Facturation immédiate en palier Freemium, statut `unverified`, palier de vélocité T0.
3. Fanta vend en ligne (WhatsApp, réseaux sociaux) : elle émet la facture, un lien de paiement Mobile Money (orchestrateur Djomy/Moneroo) est généré et envoyé au client **en parallèle** d'une livraison possible — les deux modes ne s'excluent jamais l'un l'autre.
4. Si le client préfère payer à la réception : le livreur (rôle `delivery_driver`, déjà dans les 9 rôles MVP) encaisse le cash à la livraison, preuve photo/GPS si >1M GNF, exactement comme n'importe quel encaissement cash. Le lien de paiement envoyé au client devient simplement caduc, sans action manuelle requise.
5. À mesure que le volume grandit, Fanta peut engager la vérification DGI — ce qui débloque un palier de vélocité supérieur (T1), jamais une fonctionnalité commerciale supplémentaire (les deux axes sont indépendants, ADR-049).

**Points de test critiques** : vérifier qu'aucun écran ne présente la vérification DGI comme une condition d'accès aux formules payantes ; vérifier que l'émission d'une facture avec livraison ne force jamais un choix exclusif entre lien de paiement et cash — les deux doivent rester disponibles jusqu'à ce que l'un des deux soit effectivement utilisé.

---

## 9. Parcours Ousmane — vérification publique sans compte

**Objectif : vérifier l'authenticité d'une facture reçue, sans jamais avoir de compte facture.gn.**

1. Scan du QR code ou saisie du code court sur `verify.facture.gn` (ou *620# option 2).
2. Résultat affiché sans authentification : authenticité cryptographique, statut de paiement, statut de contestation.
3. Fonctionne intégralement hors ligne via `verify-gn.js`.

**Point de test critique** : critère de réception MVP — vérification réussie en mode avion, aucune donnée commerciale sensible exposée au-delà du strict nécessaire à la vérification.

---

## 10. Parcours B2G — entrepreneur, TELEMO, et administration cliente (V1-V2)

**Personas : entrepreneur fournisseur + DAF de l'administration cliente.**

1. Préalable, une seule fois par administration cliente : l'entrepreneur (admin/owner) marque l'administration comme entité publique sur sa fiche client — `CUSTOMER.is_public_entity = true`, permission `customer:flag_public_entity` (ADR-083/098/105). Sans ce marquage, aucune facture adressée à cette administration n'entre dans le circuit de validation ci-dessous.
2. L'entrepreneur gagne un marché public sur TELEMO, reçoit une référence d'attribution.
3. Il émet une facture pour la commande publique — via PWA (parcours complet) ou *620# Option 6 (version condensée, ADR-086) — et recopie manuellement la référence marché dans le champ optionnel « Référence marché TELEMO » (ADR-090, aucune vérification automatique).
4. Le DAF de l'administration, authentifié via `public_buyer_account` (rôle `public_buyer_validator`), consulte la facture reçue sur son portail dédié — y compris la référence marché recopiée, qu'il rapproche humainement de son propre dossier si nécessaire.
5. Il valide la liquidation — jamais le paiement effectif — déclenchant `invoice.validated_by_administration = true` et l'événement `liquidation_validated`.
6. L'entrepreneur, depuis la PWA, choisit son rail : **Rail A** — une banque/MFI partenaire (Ecobank, UBA, COFINA, ou Akiba Finance) avance le montant immédiatement, disbursée via Djomy Payout ou virement au choix de l'entrepreneur ; **Rail B** — attente du virement Trésor direct, sans financement, 0% commission.
7. Sur le Rail A, le Trésor rembourse ensuite la banque — jamais l'entrepreneur, déjà payé — par cession de créance, un mécanisme que facture.gn ne voit jamais. Sur le Rail B, le paiement Trésor est détecté passivement par rapprochement bancaire.

**Points de test critiques** : une facture adressée à un client jamais marqué `is_public_entity` ne doit jamais apparaître sur le portail DAF, même si son montant ou son libellé ressemble à une commande publique ; le portail DAF ne doit jamais exposer d'action de « validation de paiement » — seulement de « validation de liquidation », pour respecter strictement le positionnement ADR-030/ADR-080 ; le choix du rail de financement n'apparaît qu'après validation DAF confirmée, jamais avant ; le champ référence marché reste optionnel sur toute la chaîne — une facture B2G sans référence TELEMO (achat de gré à gré) doit suivre exactement le même parcours sans dégradation.

---

## 11. Parcours Gestion client avancée — admin/owner et approver (V1)

**Objectif : fusionner un client dupliqué et augmenter une limite de crédit sans décision unilatérale.**

1. Un admin repère deux fiches client identiques (même téléphone, doublon créé en offline malgré la prévention ADR-038) → sélectionne « Fusionner » → choisit le client cible qui conserve l'historique → confirmation.
2. Un client régulier demande une facilité de paiement plus large : l'admin augmente `credit_limit` depuis la fiche client.
3. Si la nouvelle limite dépasse le seuil configuré (paramètre config, ADR-058) : la demande passe en attente, notification au rôle `approver` → l'approver consulte l'historique de paiement du client → valide ou rejette → l'admin est notifié de la décision.
4. Si sous le seuil : mise à jour immédiate, aucune validation requise.

**Points de test critiques** : un `cashier` ne doit jamais voir l'option de fusion ou de modification de limite de crédit (permissions `customer:merge_duplicate` / `customer:manage_credit_limit`, ADR-083, réservées admin/owner) ; une tentative d'augmentation au-delà du seuil sans `approver` disponible dans l'organisation doit être bloquée proprement, pas silencieusement acceptée.

---

## 12. Parcours Analytics et marge — business_manager (V1, palier Pro+)

**Objectif : consulter la marge réalisée par produit, sans exposer le coût d'achat à un rôle non autorisé.**

1. Renseignement du coût d'achat sur une fiche produit (`cost_price`, nullable — jamais bloquant à la création, ADR-084).
2. À chaque facturation, `cost_price_at_time` capture ce coût au moment précis de la vente.
3. Le business_manager (ou owner/admin) ouvre le tableau analytics avancé → sélectionne « Par produit » → voit CA et marge, en GNF et en pourcentage.
4. Un `cashier` connecté à la même organisation Pro ouvre le même écran analytics : les chiffres de CA/volume s'affichent, la colonne marge reste masquée (permission `analytics:view_margin` absente de son rôle).

**Points de test critiques** : modifier `cost_price` après coup ne doit jamais recalculer la marge des factures déjà émises — le rapport doit refléter `cost_price_at_time`, pas la valeur courante ; vérifier explicitement qu'aucun endpoint ni écran ne fuite la marge à un rôle non autorisé même par un raccourci (export CSV, API).

---

## 13. Parcours Support client — Chargé de support client (V1)

**Objectif : honorer le SLA de réponse par sévérité, avec escalade propre vers le squad technique si nécessaire.**

1. Un marchand Enterprise signale un lien de paiement qui ne fonctionne plus (Critique) → ticket créé, canal WhatsApp Business API pour ce palier.
2. Le Chargé de support client répond dans le délai contractuel (4h ouvrées, ADR-085) → diagnostic de premier niveau.
3. Si le problème dépasse la compétence support pure (ex. panne réelle de l'orchestrateur Djomy) → escalade vers le Squad Money, avec accès temporaire au compte client via `cross_tenant_grant` (ADR-029) en session limitée dans le temps.
4. Un marchand Freemium pose une question cosmétique (Mineur) → traitement best effort, FAQ/communauté en premier recours.

**Points de test critiques** : le chronomètre du SLA démarre à la création du ticket, pas à sa prise en charge effective — mesurer le temps de réponse réel, pas déclaratif ; l'accès `cross_tenant_grant` du support doit expirer automatiquement et ne jamais devenir un accès permanent, quel que soit le nombre de tickets traités sur un même compte.

---

## 14. Parcours tax_controller_readonly — invitation d'un contrôleur fiscal (ADR-104/105, F14)

**Objectif : donner à un contrôleur fiscal local un accès en lecture seule à ses propres factures et à l'export FEC, sans jamais partager le PIN du propriétaire.**

1. Depuis Équipe & Rôles, un owner ou admin invite un contrôleur fiscal par numéro de téléphone, rôle `tax_controller_readonly` (renommé depuis dgi_readonly, ADR-104).
2. L'accès est composé uniquement de permissions déjà existantes en lecture seule (`invoice:view`, `export:fec`) — aucune capacité d'écriture, aucune fonctionnalité au-delà.
3. Le contrôleur consulte les factures de l'organisation et exporte le FEC ; toute tentative d'action d'écriture est refusée par le RBAC, pas seulement masquée à l'écran.
4. L'owner révoque l'accès à tout moment depuis la même fiche.

**Points de test critiques** : vérifier qu'aucun endpoint en écriture n'est accessible même par appel API direct avec un token `tax_controller_readonly` ; vérifier que ce mécanisme ne se présente jamais comme un accès de la DGI institutionnelle elle-même — c'est un individu invité par l'organisation, distinct de la persona DGI nationale (ADR-104).

---

## 15. Parcours inventory_manager — gestion de stock par succursale (ADR-097, E10)

**Objectif : enregistrer un mouvement de stock sans jamais bloquer l'émission de facture sur un stock insuffisant.**

1. Un inventory_manager (ou owner/admin) ouvre Produits & Stock, sélectionne un produit et une succursale.
2. Il enregistre un mouvement — réception fournisseur, ajustement d'inventaire, ou perte/casse — quantité toujours positive, le type de mouvement détermine le sens.
3. `PRODUCT_STOCK.stock_qty` est mis à jour immédiatement pour la succursale concernée.
4. Un cashier émettant une facture sur ce même produit, même en stock bas ou nul, n'est jamais bloqué — le stock est informatif, jamais un gate d'émission (même philosophie que `cost_price`, ERD).

**Points de test critiques** : vérifier qu'un inventory_manager n'a jamais accès à `cost_price` ni à la marge (territoire business_manager, sauf cumul explicite de rôle) ; vérifier qu'aucun message ni blocage n'apparaît à l'émission d'une facture sur un produit en stock négatif ou nul.

---

## 16. Parcours auditor — journal d'audit en lecture seule (ADR-097, G4)

**Objectif : consulter l'historique complet des événements de facturation et des changements de permission, sans aucune capacité de modification.**

1. Un auditor (ou owner/admin) ouvre le Journal d'audit.
2. Il filtre par catégorie — facture, paiement, ou permission.
3. Il consulte `invoice_event` (append-only, ADR-015) et l'historique des changements de rôle/permission de l'organisation.
4. Aucune action de modification n'est jamais exposée à ce rôle sur cet écran, ni ailleurs dans le produit.

**Points de test critiques** : vérifier qu'aucun bouton, endpoint, ou raccourci n'expose une action d'écriture à un compte auditor pur ; vérifier que le filtre par catégorie regroupe les entrées sans jamais en masquer aucune.

---

## 17. Parcours developer_api — clés API self-service (ADR-097, F15)

**Objectif : générer et révoquer des clés API sans dépendre du support, avec un secret jamais ré-affichable après création.**

1. Un developer_api (ou admin/owner, palier Pro+) ouvre Développeur/API.
2. Il génère une nouvelle clé — le secret complet s'affiche une seule fois, à cet instant précis.
3. Il consulte les logs d'appels récents (méthode, endpoint, statut, horodatage) en lecture seule.
4. Il révoque une clé compromise ou obsolète — effet immédiat, aucune fenêtre de grâce.

**Points de test critiques** : vérifier que le secret complet n'est jamais récupérable après la réponse de création, ni par l'API ni par l'interface ; vérifier qu'une clé révoquée est rejetée immédiatement sur le prochain appel, pas seulement marquée inactive en base.

---

## 18. Plan de test — méthodologie

### 18.1 Principes directeurs

- **Chaque critère de réception MVP est testé avec un persona réel**, pas seulement un jeu de données synthétique — la colonne « Méthode de validation » ci-dessous le rend explicite.
- **Definition of Done** (CdC §6) : revue par 2 pairs, couverture de test ≥ 85 %, revue de sécurité obligatoire sur tout changement touchant authentification, RBAC, cryptographie, paiements, ou données personnelles.
- **Aucun test de paiement en production ne se substitue au test en sandbox** — la séquence est toujours sandbox d'abord (Chef d'Orchestre, tâche d3), production ensuite (tâche d4).

### 18.2 Critères de réception MVP — table de traçabilité

| Critère | Mesure | Méthode de validation | Parcours associé |
|---|---|---|---|
| Zéro perte de données après coupure réseau | 0 facture perdue sur 1000 tests | Test de résilience réseau | Parcours Ibrahima (§6) |
| Offline 48h démontré | Émission + encaissement après 48h sans réseau | Test terrain Coyah | Parcours Ibrahima (§6) |
| QR vérifiable sans internet | Vérification offline via `verify-gn.js` | Test en mode avion | Parcours Ousmane (§9) |
| FEC exportable sans rejet | 0 rejet sur fichier test anonymisé | Test logiciel comptable réel | Parcours Mamadou/CGA (§3) |
| Orange Money > 98 % succès (via Djomy) | Taux sur 24h glissantes | Monitoring orchestrateur + polling | Parcours Aissatou (§2) |
| USSD < 90s sur feature phone | Chronométrage terrain | Test avec Mariama | Parcours Mariama (§4) |
| TTV < 5 min | Inscription → première facture test | Test avec Aissatou | Parcours 0, Chemin A (§1.1) |
| Commission captée sans fuite | 100 % des paiements non-cash via lien orchestré | Audit réconciliation webhook/payment | Parcours Aissatou (§2) |
| Bascule Djomy→Moneroo prouvée | Timeout 10s → transaction complétée sans intervention | Test de bascule automatique | Chef d'Orchestre, tâche m2 |

### 18.3 Critères V1/V2 — gestion client, analytics, support, multi-numéros, B2G étendu

| Critère | Mesure | Méthode de validation | Parcours associé |
|---|---|---|---|
| Marge jamais recalculée rétroactivement | cost_price_at_time figé après émission | Modifier cost_price puis relire une ancienne facture | Analytics et marge (§12) |
| Marge invisible aux rôles non autorisés | 0 fuite via écran, export CSV, ou API | Test avec un compte cashier | Analytics et marge (§12) |
| Augmentation credit_limit hors seuil bloquée sans approver | 0 mise à jour directe au-delà du seuil | Test avec organisation sans rôle approver actif | Gestion client avancée (§11) |
| SLA support respecté par sévérité | Chronométrage réel création → première réponse | Test avec ticket simulé par palier | Support client (§13) |
| Utilisateur reconnu sur un second numéro sans code compte | 0 demande de code compte pour un numéro déjà vérifié | Appeler *620# depuis un second numéro enregistré | Multi-numéros (ADR-087) |
| Vente en ligne et livraison cash jamais mutuellement exclusifs | Les deux modes restent actifs jusqu'à usage effectif de l'un | Test avec Fanta, facture avec livraison | Parcours Fanta (§8) |
| Facture B2G sans référence marché suit le même parcours | 0 dégradation fonctionnelle sur une facture sans reference_marche | Émettre une facture B2G sans référence, comparer au parcours avec | Parcours B2G (§10) |
| Rail de financement proposé seulement après validation DAF | 0 option de rail visible avant liquidation_validated | Tenter le choix de rail sur une facture non validée | Parcours B2G (§10) |
| Double financement bloqué | 0 seconde avance sur une facture déjà financée | Tenter un second financement sur une facture avec financed_by_partner_id renseigné | Parcours B2G (§10) |
| Facture jamais visible au DAF sans marquage préalable | 0 facture d'un client non is_public_entity sur le portail DAF | Émettre une facture à un client jamais marqué entité publique, vérifier absence côté DAF | Parcours B2G (§10) |
| tax_controller_readonly strictement lecture seule | 0 action d'écriture acceptée, même par appel API direct | Tenter POST/PATCH/DELETE avec un token tax_controller_readonly | Contrôleur fiscal (§14) |
| Stock jamais un gate d'émission | 0 blocage à l'émission sur un produit en stock nul ou négatif | Émettre une facture sur un produit à stock_qty = 0 | Stock (§15) |
| Journal d'audit strictement lecture seule | 0 action de modification exposée à un compte auditor pur | Revue exhaustive des écrans et endpoints accessibles à auditor | Journal d'audit (§16) |
| Secret de clé API non récupérable après création | 0 moyen de relire le secret complet passé la réponse de création | Tenter une relecture du secret via API et interface après coup | Clés API (§17) |
| Clé API révoquée rejetée immédiatement | 0 appel accepté avec une clé révoquée | Révoquer une clé puis l'utiliser immédiatement | Clés API (§17) |

### 18.4 Couverture par persona — matrice de complétude

| Persona | Parcours couvert | Statut de rédaction |
|---|---|---|
| Aissatou | Onboarding Chemin A, émission/encaissement PWA | Détaillé (§1.1, §2) |
| Mamadou | Écosystème cabinet, mandat, FEC | Détaillé (§3) |
| Djénabou | Arrhes, no-show | Détaillé (§5) |
| Ibrahima | Offline, livraison terrain | Détaillé (§6) |
| Sékou | Agent commercial terrain (facture.gn, pas un rôle RBAC), inscription Chemin B, pular | Détaillé (§1.2, ADR-107) |
| Aminata | Devis, conversion | Détaillé (§7) |
| Mariama | Onboarding Chemin B, USSD *620# | Détaillé (§1.2, §4) |
| Fanta | Non-enregistré, e-commerce, livraison cash | Détaillé (§8) |
| Ousmane | Vérification publique | Détaillé (§9) |
| DGI | Bénéficiaire structurel — pas d'action produit directe | Hors plan de test fonctionnel — voir Brief DGI |
| DAF / Administration cliente | Validation de liquidation B2G | Détaillé (§10) |
| Admin/owner + approver | Gestion client avancée | Détaillé (§11) |
| business_manager | Analytics et marge | Détaillé (§12) |
| Chargé de support client | Support par SLA | Détaillé (§13) |
| TELEMO — pas un persona produit | Relais déclaratif, référence marché | Couvert dans le parcours B2G (§10), pas de parcours dédié |
| Contrôleur fiscal (tax_controller_readonly) | Invitation, accès lecture seule, révocation | Détaillé (§14) |
| inventory_manager | Mouvement de stock par succursale | Détaillé (§15) |
| auditor | Journal d'audit en lecture seule | Détaillé (§16) |
| developer_api | Clés API self-service | Détaillé (§17) |

### 18.5 Ce qui reste hors du plan de test MVP

Le parcours B2G (§10), le parcours CGA (partie du §3), et les sept parcours V1 introduits depuis (§11 à §17 — gestion client avancée, analytics/marge, support, contrôleur fiscal, stock, journal d'audit, clés API) ne sont testables en conditions réelles qu'à partir de V1. Leur présence dans ce document est une anticipation de conception, pas un engagement de test au MVP.

---

*facture.gn — Parcours UX & Plan de test — Document confidentiel — 17 août 2026*
