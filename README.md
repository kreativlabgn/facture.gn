# facture.gn

Infrastructure Nationale de Confiance Transactionnelle pour les PME de Guinée. Trois couches inséparables :

- **Trust** — certification cryptographique indépendante (Ed25519, chaînage SHA-256), vérifiable publiquement sans compte, y compris hors ligne.
- **Money** — paiement instantané orchestré (Djomy primary / Moneroo fallback) ; le marchand reçoit toujours 100 % du montant facturé.
- **Capital** — l'historique certifié devient un actif finançable.

Positionnement non négociable : tiers de confiance privé certifié — jamais un registre ni une autorité d'État.

---

## Documents

| Fichier | Contenu |
|---|---|
| `Note-Conceptuelle-facture-gn.md` | Vision produit, personas, phasage MVP/V1/V2 |
| `CdC-facture-gn.md` | Cahier des charges |
| `PRD-facture-gn.md` | Exigences produit détaillées |
| `DAT-facture-gn.md` | Architecture technique — bounded contexts, RBAC, modèle de données |
| `ERD-facture-gn.md` | Schéma de données détaillé |
| `openapi-facture-gn.yaml` | Spécification API |
| `Registre-ADR-facture-gn.md` | Journal des décisions d'architecture (jusqu'à ADR-103) |
| `Backlog-facture-gn.md` | Backlog produit par section fonctionnelle |
| `Risques-RACI-facture-gn.md` | Registre des risques et matrice RACI |
| `Grille-Offres-facture-gn.md` | Grille tarifaire par palier |
| `Parcours-UX-Plan-de-test-facture-gn.md` | Parcours utilisateurs et plan de test |
| `Fiches-de-poste-facture-gn.md` | Organisation des squads |
| `Spec USSD facture-gn.md` | Spécification du canal `*620#` |
| `Maquette-facture-gn.html` | Maquette HTML de référence |
| `Charte_Graphique_Design_System_facture_gn.pdf` | Charte graphique |

## Maquette de référence

`Maquette-facture-gn.html` est un fichier autonome — polices embarquées, aucune dépendance externe — qui s'ouvre directement dans un navigateur. Un sélecteur de shell en tête de page donne accès à :

1. **App PME** — tableau de bord, factures, clients, émission, et les 9 sections du tiroir (approbations, analytics, stock, paiements, équipe & rôles, journal d'audit, développeur/API, paramètres, support)
2. **Cabinet/CGA** — portefeuille de mandats, demande de mandat, gestion cabinet
3. **Administration publique (DAF)** — factures reçues, validation de liquidation
4. **Client** (`client_portal`) — factures reçues tous émetteurs confondus, paiement
5. **Lecture DGI** — hypothèse de travail non validée par le propriétaire produit (ADR-097)
6. **Console interne** — recherche organisation, tickets support, feature flags, rôles système, logs d'audit globaux
7. **Écrans hors périmètre** — Checkout, vérification publique, USSD, Commande Publique (style d'exécution d'origine, non retouché)

Architecture de navigation actée en ADR-095 ; direction visuelle (fond clair, Or de Guinée `#FBB500`, Nuit Atlantique `#0B1D3A`) actée en ADR-103.

## Statut

| Phase | Échéance | Contenu |
|---|---|---|
| MVP | T3 2026 | Trust Layer complet, orchestrateur de paiement, USSD `*620#`, offline 48h |
| V1 | T4 2026 – T1 2027 | Lancement national, portail cabinet/CGA complet, portail admin publique |
| V2 | 2027-2028 | Capital Layer — scoring, factoring B2G, portail bancaire |

Agrément PDP (Plateforme de Dématérialisation Partenaire) visé Q3 2027 — produit autonome sans dépendre de cet agrément (R-01, Risques-RACI).
