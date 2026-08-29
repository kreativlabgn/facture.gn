# Architecture — facture.gn

Diagrammes C4 (niveaux 1 et 2) et flux d'authentification. Rendu Mermaid natif sur
GitHub. Source de vérité métier : `../../../V/DAT-facture-gn.md`.

État au 2026-08-29 : `trust-api`, `money-api`, `web`, `packages/db` sont scaffoldés.
Cert-Engine Rust, Redis/BullMQ, MinIO, Capital/Platform Contexts : cibles DAT non
encore construites (en pointillés ci-dessous).

## Niveau 1 — Contexte

```mermaid
graph TB
    pme["PME guinéenne<br/>(10 personas — Aissatou, Mamadou…)"]
    client["Client / acheteur<br/>(client_portal)"]
    daf["DAF — Administration publique<br/>(public_buyer_validator, B2G)"]
    agent["Agent commercial terrain<br/>(inscription assistée)"]
    cabinet["Cabinet comptable / CGA"]

    facture["<b>facture.gn</b><br/>Infrastructure de confiance<br/>Trust · Money · Capital"]

    dgi["DGI / eTax<br/>(vérification NIF)"]
    apip["APIP<br/>(webhook création d'entreprise)"]
    djomy["Djomy.africa<br/>(Orange Money, MTN MoMo)"]
    moneroo["Moneroo<br/>(fallback, cartes)"]
    sms["Passerelle SMS / WhatsApp"]

    pme -->|"émet, encaisse, suit"| facture
    client -->|"consulte, paie, vérifie"| facture
    daf -->|"valide la liquidation"| facture
    agent -->|"inscrit une PME sur le terrain"| facture
    cabinet -->|"tient la compta (mandat multi-org)"| facture

    facture -->|"vérifie le NIF"| dgi
    apip -->|"notifie une création d'entreprise"| facture
    facture -->|"génère un lien, encaisse"| djomy
    facture -->|"bascule si Djomy KO < 10s"| moneroo
    facture -->|"notifie (best-effort)"| sms
```

**Positionnement non négociable** : tiers de confiance privé certifié, jamais un
registre ou une autorité d'État. Le marchand reçoit toujours 100 % du montant
facturé ; commission et frais gateway sont portés par le payeur.

## Niveau 2 — Conteneurs

```mermaid
graph TB
    subgraph client_side["Côté client"]
        web["<b>web</b> — Next.js PWA<br/>dashboard PME · page de paiement<br/>vérification publique · portail client"]
        ussd["Canal USSD *620#<br/>(passerelle opérateur → trust-api)"]
    end

    subgraph trust_ctx["Trust Context"]
        trustapi["<b>trust-api</b> — NestJS<br/>IAM (JWT RS256) · organisations · facturation core<br/>certification · vérification · USSD · portail client<br/>portail acheteur public · cabinet/CGA · FEC"]
        certengine["Cert-Engine (stub Node)<br/>Ed25519 · chaînage SHA-256"]
    end

    subgraph money_ctx["Money Context"]
        moneyapi["<b>money-api</b> — NestJS<br/>orchestrateur multi-provider · circuit breaker<br/>webhooks normalisés + idempotents"]
        djomystub["Provider Djomy (stub)"]
        moneroostub["Provider Moneroo (stub)"]
    end

    pg[("PostgreSQL 16<br/>packages/db — schéma Prisma partagé")]
    redis[["Redis + BullMQ<br/>(cible DAT — non construit)"]]
    minio[["MinIO WORM<br/>(cible DAT — non construit)"]]

    web -->|"HTTP, server-side only"| trustapi
    ussd -->|"HTTP"| trustapi
    trustapi --> certengine
    trustapi -->|"génère un lien de paiement<br/>(X-Internal-Api-Key, best-effort)"| moneyapi
    moneyapi -->|"confirme le paiement<br/>(X-Internal-Api-Key, jamais best-effort)"| trustapi
    moneyapi --> djomystub
    moneyapi --> moneroostub

    trustapi --> pg
    moneyapi --> pg

    trustapi -.-> redis
    trustapi -.-> minio

    classDef todo stroke-dasharray: 5 5,opacity:0.6
    class redis,minio,certengine todo
```

**Note sur les bases** : `trust-api` et `money-api` partagent une instance Postgres
via `packages/db`. Les tables `payment_provider_attempt` / `payment_webhook` sont la
propriété d'écriture exclusive de `money-api` (séparation applicative, pas encore au
niveau base — cible : schémas Postgres distincts).

## Flux d'authentification inter-services

```mermaid
sequenceDiagram
    participant U as Utilisateur (PME)
    participant W as web
    participant T as trust-api
    participant M as money-api
    participant P as Provider (Djomy)

    U->>W: connexion
    W->>T: POST /auth/login
    T-->>W: JWT RS256 (TTL 12h, vérifié contre revoked_token à chaque requête)

    U->>W: émettre une facture
    W->>T: POST /invoices/:id/issue (Bearer JWT)
    Note over T: SELECT … FOR UPDATE<br/>numéro séquentiel OHADA · certification Ed25519
    T->>M: POST /payment-links (X-Internal-Api-Key, best-effort)
    M->>P: créer un lien de paiement
    P-->>M: providerRef + URL
    M-->>T: lien
    T-->>W: facture certifiée + lien

    P->>M: webhook « payé » (signature HMAC vérifiée)
    Note over M: PaymentWebhook inséré APRÈS traitement complet<br/>@@unique(provider, providerRef) — jamais traité 2×
    M->>T: POST /invoices/:id/payments/provider-confirmation<br/>(X-Internal-Api-Key, jamais best-effort)
    Note over T: Idempotency-Key UUID v4 — replay renvoie le paiement existant
    T-->>M: 200
```

### Secrets inter-services (un par périmètre de confiance, jamais réutilisés)

| Secret | Périmètre |
|---|---|
| `MONEY_API_INTERNAL_KEY` | trust-api ↔ money-api |
| `DGI_VERIFICATION_INTERNAL_KEY` | déclenchement de la vérification DGI (backoffice) |
| `COMMERCIAL_AGENT_GRANT_INTERNAL_KEY` | octroi du statut agent terrain |
| `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY` | outil interne Squad Money |
| `APIP_WEBHOOK_SECRET` | partenaire externe APIP (clé + HMAC-SHA256 sur corps brut) |
| `CERTIFICATION_MASTER_KEY` | enveloppe AES-256-GCM des clés Ed25519 par organisation |

## Voir aussi

- `../plans/` — un plan par story livrée (contexte, décisions, alternatives écartées)
- `../../CONTRIBUTING.md` — workflow, conventions, pièges
- `../../../V/Registre-ADR-facture-gn.md` — décisions d'architecture datées
