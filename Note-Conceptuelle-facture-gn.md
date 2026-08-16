# facture.gn — Note Conceptuelle

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Positionnement stratégique

| Champ | Valeur |
|---|---|
| Date | 26 juillet 2026 |
| Audience | Investisseurs, partenaires institutionnels, DGI, Ordre des Comptables, banques/MFI |
| Statut | Consolidé — cartographie institutionnelle complète (TELEMO inclus), financement B2G à deux rails, partenaires financiers vérifiés |
| Documents techniques | PRD · DAT · Backlog · Registre ADR · Spec USSD · Risques-RACI · ERD |

> Le « pourquoi » et le « pour qui » avant le « comment ».

---

## 1. Le problème

150 000 PME guinéennes facturent sur papier, sur WhatsApp, ou pas du tout. Un commerçant à Madina qui vend 500 000 GNF de marchandise n'a aucune preuve que la transaction a eu lieu. Un entrepreneur qui livre une commande publique ne peut pas financer sa créance parce que la banque ne peut pas vérifier l'authenticité de sa facture.

---

## 2. La thèse

La confiance transactionnelle est le goulot d'étranglement de l'économie guinéenne. L'infrastructure qui la résout capture ensuite le paiement, puis le financement. Trois couches inséparables : Trust Layer (preuve mathématique indépendante de facture.gn), Money Layer (paiement instantané, marchand reçoit 100%), Capital Layer (historique certifié devient un actif).

---

## 3. Pourquoi maintenant

Réglementaire (Côte d'Ivoire/RDC 2025, Tunisie depuis 2016). Technologique (SYNERGUI-SAFIG 2 et eTax depuis juin 2025, NimbaPay lancé le 22 juillet 2026). Économique (Mobile Money mature, TrésorPay depuis décembre 2025). Constitutionnel (référendum septembre 2025). Concurrentiel (aucune solution existante ne couvre le contexte guinéen).

---

## 4. Pour qui

### 4.1 Les PME — 150 000 cibles directes

Tous les secteurs, tous les niveaux de formalisation, du smartphone au feature phone GSM.

### 4.2 Les cabinets comptables et CGA — multiplicateurs d'adoption

Un cabinet qui gère 30 PME et adopte facture.gn = 30 PME onboardées d'un coup. Dashboard multi-entreprises, système de mandat révocable, revenue share (10% de la commission, plafonné). Depuis le 26/07, le CGA (Centre de Gestion Agréé, décret du 17 février 2017, tutelle DGI, abattement fiscal -50%/-25% sur 3 ans) rejoint ce modèle comme 4e type de professional_practice — canal d'acquisition et de rétention supplémentaire, avec le même mécanisme que les cabinets comptables.

### 4.3 L'État — DGI, administration publique

La DGI est un bénéficiaire structurel : chaque PME qui émet sa première facture certifiée élargit mécaniquement l'assiette fiscale, comme effet secondaire de la certification — jamais comme mission première de facture.gn. Les administrations publiques valident les factures de commandes publiques via leur DAF pour les rendre finançables. facture.gn se positionne comme Plateforme de Dématérialisation Partenaire (PDP) — un tiers certifié privé, jamais un registre d'État.

### 4.4 Les banques et microfinances

Trois niveaux d'intégration : vérification passive gratuite, portail bancaire (V1-V2), scoring et factoring (V2). Depuis les travaux sur le financement B2G (ADR-088/089), quatre premiers partenaires financiers identifiés et vérifiés : Ecobank, UBA (banques), COFINA, Akiba Finance (MFI — agréée BCRG, inclusion financière PME/femmes, positionnement qui recoupe directement notre propre thèse).

---

## 5. Cartographie institutionnelle — positionnement « en dessous »

facture.gn ne fait pas de compta, ne fait pas de financement, ne fait pas d'accompagnement. C'est l'infrastructure qui permet à chaque acteur institutionnel de remplir sa propre mission — jamais un concurrent, toujours un niveau en dessous.

| Acteur | Son KPI | Ce que facture.gn apporte | Nature de la relation |
|---|---|---|---|
| APIP | Nb entreprises créées/an | Auto-création du compte facturation dès la formalisation, via webhook | Canal d'acquisition à la source (V1) |
| CGA | Nb adhérents formalisés, centrale des bilans | Dashboard multi-adhérents, FEC sans rejet | Cockpit multi-tenant, professional_practice type dédié (V1) |
| DGI | Élargissement de l'assiette fiscale | FEC exploitable produit mécaniquement à chaque certification | Bénéficiaire structurel, jamais opérateur |
| FODIP | Décaisser sur des projets PME mesurables | Projet mesurable avec traçabilité (volume facturé, impôts payés) | Convention externe, dashboard lecture seule |
| 3AE / MIC | Structurer les PME, concours | Outil concret de structuration | Referral, codes promo |
| DAF / Administration cliente | Piloter l'encours fournisseurs | Réception de factures certifiées, validation de liquidation | Portail acheteur public (V1-V2) |
| TELEMO | Digitaliser la passation des marchés publics | Continuité naturelle : la PME qui gagne un marché sur TELEMO le facture sur facture.gn | Partenaire amont, relais déclaratif sans intégration technique (V1, ADR-090) |

**Phrase de synthèse** : facture.gn ne fait pas de compta, ne fait pas de financement, ne fait pas d'accompagnement. On est l'infrastructure qui permet à CGA de faire de la compta, à FODIP de financer avec traçabilité, à 3AE d'accompagner avec un outil, à la DGI de percevoir davantage sans rien changer à son mandat, à TELEMO de voir ses marchés attribués se transformer en créances certifiées et finançables.

---

## 6. Comment ça marche

### 6.1 Émettre une facture — < 2 secondes

Le marchand ouvre la PWA ou compose *620#. Facture signée (Ed25519), chaînée (SHA-256), lien de paiement envoyé automatiquement (WhatsApp/SMS). Offline jusqu'à 48 heures.

### 6.2 Payer une facture — un clic

Le client clique sur le lien, voit le montant + frais de transaction, choisit son moyen de paiement (Orange Money, MTN MoMo, carte). Le lien est résolu par l'orchestrateur de paiement : Djomy en primary (Orange Money et MTN MoMo Guinée en direct), Moneroo en fallback (cartes internationales, et bascule automatique si Djomy ne répond pas sous 10 secondes). Le marchand reçoit 100% du montant facturé — les frais sont portés par le payeur.

### 6.3 Vérifier une facture — 3 secondes

QR ou code court *620#, sans compte, sans internet. Affiche authenticité, statut de paiement, statut de contestation, et validation administrative si applicable.

### 6.4 Financer une créance — deux rails, au choix de la PME (V2)

Un entrepreneur avec une facture certifiée d'une commande publique, validée par le DAF de l'administration cliente (constatation de la liquidation de la dette — jamais le paiement effectif de l'État), choisit entre deux chemins, toujours disponibles en parallèle : être payé immédiatement par une banque ou MFI partenaire (le Trésor la rembourse ensuite, jamais la PME), ou attendre le virement du Trésor directement, sans financement. Dans les deux cas, le crédit ou le paiement s'appuie sur une créance doublement certifiée — authenticité crypto et validation administrative.

---

## 7. Modèle économique

### 7.1 Revenus PME — grille à 5 paliers (26/07)

Émission et encaissement gratuits et illimités pour tous. Les formules payantes débloquent des fonctionnalités. La commission sur chaque encaissement non-cash est le moteur de revenu principal, avec une grille refondue le 26/07 : Freemium 2,5% (cible négo 2,0%), Starter 2,0% (1,5%), Pro 1,5% (1,0%), Enterprise 1,2% (1,0%), Custom volume 1,0% (0,8% floor) — caps différenciés de 50 000 à 150 000 GNF. Total payeur inclut 1% de frais gateway Djomy. Projection M18 à 10k organisations : Money net 1 660M GNF/mois (+66% vs l'ancienne grille à taux unique), revenu total 2 080M GNF/mois ≈ 241k USD.

### 7.2 Revenus partenaires

Les cabinets et CGA paient un abonnement Partner et reçoivent un revenue share (10% de la commission facture.gn de leurs clients mandatés, plafonné 5 000 GNF/mois/client). Les banques/MFI paient un abonnement API et une commission d'apport (V2).

### 7.3 Alignement d'intérêts

facture.gn ne gagne que quand la PME est payée. Le cabinet/CGA ne gagne que quand ses clients encaissent en non-cash. La banque ne finance que des créances certifiées. North Star metric : taux d'encaissement > 95%.

---

## 8. Feuille de route

| Phase | Période | Contenu clé |
|---|---|---|
| MVP | T3 2026 (M1-3) | 50+ pilotes Conakry. Trust Layer complet, orchestrateur de paiement, USSD *620#, offline 48h, cabinets comptables/CGA. |
| V1 | T4 2026-T1 2027 (M4-9) | Lancement national. MTN MoMo/Wave, vocal multilingue, facturation récurrente, portail cabinet/CGA complet, webhook APIP, portail admin publique (validation DAF). |
| V2 | 2027-2028 (M10-18) | Capital Layer. Scoring, factoring B2G, portail bancaire, agrément PDP. |

---

## 9. Gouvernance

| Rôle | Titulaire | Mandat |
|---|---|---|
| Sponsor exécutif | Bou Bakar | Décision finale, arbitrage budget, second signataire ≥ 10M GNF |
| Directrice Générale | À nommer | Pilotage opérationnel, validation seule ≤ 10M GNF |

---

## 10. Pourquoi c'est difficile à copier

**Faible — le produit.** Un système de facturation avec signature crypto est réplicable en quelques mois.

**Moyenne — l'inclusion.** Offline 48h, USSD *620#, vocal multilingue — un travail spécifique au contexte guinéen.

**Forte — l'antériorité de l'historique certifié.** Effet réseau de données, pas un avantage produit.

**Forte — l'écosystème partenaire.** Cabinets, CGA, Ordre des Comptables, banques/MFI — chaque couche d'adoption renforce les autres.

---

## 11. Risques structurels

**Le plus critique** : si la DGI choisit un modèle centralisé façon El Fatoora plutôt qu'un agrément PDP multi-acteurs, facture.gn est directement concurrencé par l'État, sans mitigation technique possible. Positionnement institutionnel précoce requis — DGI explicitement nommée comme bénéficiaire structurel (§5), jamais comme régulateur à convaincre après coup.

**Le plus surveillé** : NimbaPay opère à la couche interbancaire, pas à la couche facturation — complémentaire, pas concurrent.

**Le plus récent** : vendor lock-in Djomy (provider primary du paiement) — mitigé par le fallback Moneroo prouvé (bascule automatique testée sur timeout).

---

*facture.gn — Note Conceptuelle — Document confidentiel — 26 juillet 2026*
