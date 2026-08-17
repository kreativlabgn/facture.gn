# facture.gn — Risques & RACI

**Infrastructure de Facturation Certifiée · PME de Guinée**

## Registre des risques et matrice de responsabilité

| Champ | Valeur |
|---|---|
| Date | 17 août 2026 |
| Statut | Consolidé — intègre T-04/ADR-072 (Djomy primary), R-13 (vendor lock-in Djomy), R-14 (adoption B2G), G-06 (SLA support, résolu), RACI partenaires, B-08 échelle de réponse formalisée (ADR-091), B-10 amorçage Capital, R-12 revérifié J+26 après lancement NimbaPay (constat inchangé) |
| Audience | Sponsor exécutif, Direction Générale, Product Owner, Tech Lead/Architecte |
| Documents liés | DAT · PRD · Backlog · Registre ADR · CdC |

> Document vivant, à réviser à chaque jalon majeur.

---

## 1. Risques techniques et sécurité

| ID | Risque | Prob. | Impact | Mitigation | Owner | Statut |
|---|---|---|---|---|---|---|
| T-01 | Panne HSM cloud | Faible | Critique | HSM fallback, rotation auto, alerte immédiate | Squad Trust | Mitigé |
| T-02 | Corruption chaîne SHA-256 | Très faible | Critique | Vérification périodique, alerte sur rupture | Squad Trust | Mitigé |
| T-03 | Vol d'appareil avec session active | Moyenne | Moyen | Gel T0 24-48h post-reset PIN, plafonds velocity_tier | Squad Platform | Mitigé |
| T-04 | Panne Djomy (provider primary) | Moyenne | Élevé | Fallback Moneroo automatique (circuit breaker 10s, ADR-072/073), réconciliation manuelle cash | Squad Money | Actif — corrigé 26/07 (était « Panne Moneroo / fallback CinetPay », stale depuis l'inversion primary/fallback) |
| T-05 | Collision code court USSD | Très faible | Faible | Vérification unicité à la génération (ADR-047) | Squad Money | Mitigé |
| T-06 | Désynchronisation offline >48h | Faible | Moyen | CRDT monotone, alerte à 36h, résolution manuelle | Squad Money | Mitigé |

---

## 2. Risques business et adoption

| ID | Risque | Prob. | Impact | Mitigation | Owner | Statut |
|---|---|---|---|---|---|---|
| B-01 | Adoption PME insuffisante | Moyenne | Élevé | Onboarding assisté, TTV <5min, Freemium illimité, cabinets/CGA multiplicateurs | DG | Actif |
| B-02 | Panne/latence opérateur MM | Moyenne | Moyen | Webhook + polling, réconciliation nocturne, orchestrateur multi-provider | Squad Money | Mitigé |
| B-03 | Rejet du format FEC par la DGI | Moyenne | Élevé | Co-développement DGI, sandbox | Squad Capital | Actif |
| B-04 | Gaming du Capital Layer | Moyenne | Élevé | Détection comportementale (ADR-032), is_financeable() | Squad Capital | Descopé MVP |
| B-05 | Tarification Money non calibrée | Moyenne | Moyen | Grille à 5 paliers (ADR-074), paramètre config ADR-058, validation par 50 pilotes, ajustable sans refactoring | DG | Mitigé par conception |
| B-06 | Coût de session USSD non chiffré | Moyenne | Moyen | Frais portés par le payeur pour sessions paiement. Deal Orange en chiffrage (0,5% commission Money contre USSD gratuit émission). Gap résiduel : session d'émission pure | Squad Money | Partiellement résolu |
| B-07 | Segment vendeur ambulant hors cible | Faible | Faible | Choix de scope conscient | PO | Accepté |
| B-08 | Fuite de commission (paiement hors lien) | Moyenne | Moyen | ADR-061 (méthodes manuelles restreintes), détection comportementale (G3), échelle de conséquences à quatre niveaux formalisée (ADR-091) | Squad Money | Mitigé, échelle de réponse formalisée |
| B-09 | Turnover comptable dans les cabinets/CGA | Faible | Faible | Mandat au cabinet/practice pas à l'individu (ADR-069), révocation automatique au départ | Squad Platform | Mitigé |
| B-10 | Score de confiance (ADR-093) construit sans validation des critères réels de souscription bancaire — refonte possible en V2 si le format ne correspond pas | Faible | Moyen | Prise de contact précoce Sponsor/DG avec Akiba Finance (MFI déjà identifiée, ADR-088/089) pour valider les signaux pertinents avant que le format ne soit figé davantage — sans LOI ni échéance contraignante | DG | NOUVEAU — Ouvert, action en cours |

---

## 3. Risques réglementaires et institutionnels

| ID | Risque | Prob. | Impact | Mitigation | Owner | Statut |
|---|---|---|---|---|---|---|
| R-01 | Fenêtre PDP repoussée >2028 | Moyenne | Élevé | Produit autonome sans agrément | Sponsor | Surveillé |
| R-02 | DGI choisit modèle centralisé El Fatoora | Moyenne | Critique | Positionnement institutionnel précoce, Brief DGI repositionné en bénéficiaire structurel (ADR-079) | Sponsor | **RISQUE STRUCTUREL LE PLUS CRITIQUE** |
| R-03 | TrésorPay étend vers certification commerciale | Faible | Élevé | Veille institutionnelle | Sponsor | Surveillé |
| R-04 | Qualification TVA no-show non conforme | Moyenne | Moyen | Paramètre config (ADR-058), ajustable | DG | Ouvert, atténué |
| R-05 | Seuils fiscaux erronés/obsolètes | Faible | Moyen | Paramètre config versionné (ADR-058) | DG | Ouvert, atténué |
| R-06 | Plafonds velocity_tier T2/T3 mal calibrés | Moyenne | Moyen | Paramètre config, recalibrage sans refactoring | Squad Money | Ouvert, atténué |
| R-07 | Concurrence SenTur (Sénégal) | Faible | Faible | Signal de validation | Sponsor | Surveillé |
| R-08 | Statut fiscal association/ONG non confirmé | Faible | Moyen | Champ posé, logique différée hors MVP (ADR-057) | DG | Ouvert, non urgent |
| R-09 | Non-conformité RGPD guinéen (L/2016/037/AN) | Faible | Élevé | RLS, chiffrement, audit, minimisation | Squad Platform | Mitigé |
| R-10 | Non-conformité LBC/FT (L/2021/024/AN) | Faible | Élevé | Détection comportementale sans seuil (ADR-032) | Squad Platform | Mitigé |
| R-11 | Concurrence SenTur (Sénégal) — détail | Faible | Faible | Veille, signal de validation de thèse | Sponsor | Surveillé |
| R-12 | NimbaPay — évolution du paysage paiement national | Moyenne | Moyen | Vérifié le 17/08/26 (J+26 après lancement) : constat inchangé, aucun élément nouveau. MTN MoMo toujours absent de la cohorte de lancement (7 institutions, dont Orange Finances Mobiles), aucun calendrier public. Aucun chemin d'intégration marchand/PSP : Mojaloop expose son API (FSPIOP) aux seuls DFSP agréés BCRG, pas à un SaaS tiers — le seul accès possible serait derrière un participant existant, ce que Djomy fait déjà. Tarification non publiée, non vérifiable. Zéro métrique de maturité publiée. Attention homonyme : `nimbapay.com` (startup diaspora, 8 % de commission) n'a aucun rapport avec le système BCRG/GuiM (`guim-gn.com`) — ne pas confondre dans une recherche future. Prochaine action : contact `contact@guim-gn.com` (statut TPP/PISP tiers non agréé, grille tarifaire, calendrier MTN) ; prochaine revérification ~fin octobre 2026 | Squad Money | Surveillé — vérifié 17/08/26 |
| R-13 | Vendor lock-in Djomy (provider primary) | Moyenne | Élevé | Fallback Moneroo prouvé — circuit breaker timeout 10s, test de bascule automatique sans intervention (ADR-072/073, board d'exécution Chantier 2) | Squad Money | Actif, mitigation en cours de validation terrain |
| R-14 | Adoption administration cliente insuffisante pour validation B2G Niveau 2 | Faible, latent — V2 | Moyen si Capital Layer activé sans base de DAF valideurs | Engagement institutionnel précoce (pilote 1-2 ministères), Niveau 1 (lien sans compte) comme fallback (ADR-080) | DG | Ouvert, non urgent, V2 |
| R-15 | TELEMO élargit son périmètre vers la facturation/le paiement, ou ouvre une API sans qu'on l'ait anticipé | Faible | Moyen — réévaluation R-02-like nécessaire si ça se produit | Veille active, `reference_marche` conçu pour compatibilité API future sans dépendance actuelle (ADR-090) | Sponsor | NOUVEAU — Surveillé |
| R-16 | Un grossiste (FINANCIAL_PARTNER type fournisseur_crediteur, ADR-100) octroie du crédit privé à ses boutiques clientes sans être un établissement agréé — activité de crédit potentiellement non réglementée au sens du droit guinéen | Moyenne | Élevé — exposition légale directe si construit sans cadrage | Qualification juridique préalable obligatoire avant toute construction du mécanisme d'avance ; non traité au MVP, chantier V2 explicitement suspendu à cet avis | Sponsor | NOUVEAU — Non mitigé, construction bloquée sans avis juridique |

---

## 4. Risques gouvernance et exécution

| ID | Risque | Prob. | Impact | Mitigation | Owner | Statut |
|---|---|---|---|---|---|---|
| G-01 | Équipe technique non recrutée | Résolu | — | Équipe complète confirmée le 25/07/2026 | Sponsor | **RÉSOLU** |
| G-02 | Aucun chiffrage budgétaire | Élevée | Élevé | Chiffrage requis avant engagement au-delà du MVP | Sponsor | Actif |
| G-03 | Assistante et mentor non pourvus | Moyenne | Moyen | Recrutement en parallèle | Sponsor | Actif |
| G-04 | Divergence lignées documentaires | Résolu | — | Documents antérieurs retirés, suite consolidée 25/07+26/07 = source unique | Sponsor | **RÉSOLU** |
| G-05 | Perte décision lors de réécriture | Moyenne | Moyen | Recoupement systématique, audit de cohérence avant diffusion — appliqué via lecture linéaire intégrale des documents | PO / Tech Lead | Actif — vigilance permanente |
| G-06 | SLA support promis sans staffing dédié | Résolu | — | Ouverture de 2 postes Chargé de support client, rattachés DG (ADR-085) | Sponsor | **RÉSOLU**

---

## 5. Matrice RACI

*R = Responsable · A = Approbateur · C = Consulté · I = Informé*

| Domaine | Sponsor | DG | PO | Tech Lead | Comité pilotage |
|---|---|---|---|---|---|
| Arbitrage budget ≤ 10M GNF | I | A/R | C | C | I |
| Arbitrage budget ≥ 10M GNF | A | R | C | C | I |
| Priorisation backlog produit | I | C | A/R | C | I |
| Décisions architecture (ADR) | I | I | C | A/R | I |
| Scope MVP/V1/V2 (ajout/retrait) | A | C | R | C | C |
| Recrutement équipe technique | A | C | C | C | I |
| Relation DGI / dossier PDP | A/R | C | I | C | I |
| Relation opérateurs MM / Djomy / Moneroo | C | I | I | A/R | I |
| Relation Ordre des Comptables (OCAECG) | A | R | C | I | I |
| Relation APIP / webhook d'acquisition | C | A/R | I | R (technique) | I |
| Relation CGA / cockpit multi-tenant | C | A | R | C | I |
| Convention FODIP / label 3AE | A | R | C | I | I |
| Relation banques/MFI partenaires | A | R | C | C | I |
| Consultation comptable/juridique | A | R | I | C | I |
| Validation jalons/démos | I | C | R | C | A |
| Gestion crise sécurité | A | I | I | R | I |
| Nomination Tech Leads | A | C | C | R | I |
| Régénération document (recoupement) | I | I | C | A/R | I |

Zones de chevauchement : le PO priorise le backlog mais n'approuve pas seul un changement de scope MVP/V1/V2 (Sponsor requis). La DG mène les relations Ordre/APIP/banques mais en rend compte au Sponsor. Pour les partenaires institutionnels, la DG pilote les conventions opérationnelles (CGA, APIP) tandis que le Sponsor exécutif approuve les engagements de positionnement stratégique (FODIP, 3AE).

---

*facture.gn — Risques & RACI — Document confidentiel — 17 août 2026*
