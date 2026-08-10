# Plan : Recevoir une organisation créée depuis APIP (F11)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — nouveau modèle `Partner`, nouvelle méthode d'authentification (HMAC-SHA256 de corps de requête, première occurrence dans ce repo), extension d'`OrganizationsService` avec une 3ᵉ variante de création
- Persona affecté : "facture.gn" elle-même (système), déclenché par APIP (Agence de Promotion des Investissements Privés) à la création d'une entreprise
- Données sensibles manipulées : secret partagé HMAC (nouveau type de secret pour ce repo), RCCM+NIF d'une organisation (déjà une catégorie de donnée existante, pas nouvelle)
- Impact réglementaire : aucun direct

## Investigation préalable
Backlog (texte exact) : *"F11 — Recevoir une organisation créée depuis APIP `[SHOULD]`. En tant que facture.gn, je veux auto-créer une organisation à partir d'un webhook APIP, afin de capter les nouvelles PME à la source de leur formalisation. - Webhook authentifié API key + HMAC-SHA256 (ADR-082). - registration_source = apip (ADR-077). - Organisation créée en Freemium, T0, unverified. - SMS d'accueil avec lien d'activation. Réf : ADR-077, ADR-082."*

ADR-077 (texte exact) : *"Nouveau champ organization.registration_source (enum organic/apip/cga_referral/fodip/partner_3ae)... Nouveau endpoint pattern POST /v1/partners/{partner_type}/{event} (ex. /v1/partners/apip/company-created) pour l'auto-création d'organisations depuis un webhook partenaire (APIP... transmet RCCM+NIF à la création d'entreprise)."*

ADR-082 (texte exact) : *"Chaque partenaire enregistré (APIP en premier lieu) reçoit une API key dédiée (header X-Partner-Key) et un secret partagé pour signer le corps en HMAC-SHA256 (header X-Partner-Signature). Vérification obligatoire à la réception. Rate limiting par partenaire. Idempotence par Idempotency-Key (ADR-016)."*

**Découverte structurante** : `Organization.registrationSource` (enum `RegistrationSource{organic,apip,cga_referral,fodip,partner_3ae}`) existe déjà dans le schema — mais AUCUN chemin applicatif n'écrit jamais autre chose que `organic` (grep confirmé, zéro référence à `registrationSource` dans tout `apps/trust-api/src`). Marqueur exact pointant vers cette story. Aucun modèle `Partner`/`PartnerLink` n'existe (ERD §2.3 les documente, jamais scaffoldés).

**Décision de scope sur "SMS d'accueil avec lien d'activation"** : HORS SCOPE — aucune infrastructure de notification (SMS/email/WhatsApp) n'existe dans ce repo (C9 reste explicitement bloquée toute la session pour cette même raison). L'organisation est créée sans membre `owner` initial (aucun utilisateur facture.gn n'existe encore pour cette PME au moment du webhook — elle vient d'être formalisée chez APIP, pas encore inscrite chez nous) ; l'activation (un futur owner qui s'inscrit et revendique cette organisation) est explicitement une story distincte, non scaffoldée ("lien d'activation" impliquerait un mécanisme de réclamation de compte qui n'existe pas non plus).

**Décision de scope sur "API key + HMAC-SHA256"** : un SEUL partenaire concerné pour le MVP ("APIP en premier lieu", texte ADR), aucune UI/API de gestion multi-partenaires n'est demandée. Mirroir du pattern déjà établi trois fois dans ce repo (`MONEY_API_INTERNAL_KEY`/`DGI_VERIFICATION_INTERNAL_KEY`/`FIELD_AGENT_GRANT_INTERNAL_KEY` — un secret partagé unique par variable d'environnement, jamais un système de clés en base de données) : `APIP_WEBHOOK_SECRET` (env var) sert à la fois de clé API attendue (`X-Partner-Key`) ET de secret HMAC (`X-Partner-Signature`) — un seul secret, deux usages, cohérent avec le MVP mono-partenaire. Un futur multi-partenaires (FODIP/3AE) nécessiterait une vraie table de clés — hors scope ici, ADR-078 confirme explicitement que FODIP/3AE restent "hors plateforme, aucune intégration technique".
**Rate limiting par partenaire** : HORS SCOPE — aucune infrastructure de rate limiting n'existe nulle part dans ce repo (grep confirmé), disproportionné à construire pour cette seule story.

**Décision de scope sur le modèle `Partner`** : ERD §2.3 (`PARTNER`, ADR-078) donne la définition complète : `id, type (apip/fodip/partner_3ae), name, conventionRef (nullable), status (active/suspended/expired), createdAt`. Scaffoldé intégralement (les 3 types de l'enum, cohérence avec la source de vérité) même si seul `apip` a une intégration technique réelle — `fodip`/`partner_3ae` restent des lignes de données possibles sans jamais recevoir de webhook (ADR-078 : "Aucune intégration technique pour ces deux derniers"). Un seul `Partner` de type `apip` sera créé en pratique pour le MVP (pas de mécanisme d'enregistrement dynamique de nouveaux partenaires — hors scope, aucun signal backlog).

**Décision de scope sur le endpoint** : `POST /v1/partners/:partnerType/:event` respecte EXACTEMENT le pattern défini par ADR-077 (décision explicite, pas une suggestion) — premier endpoint versionné (`/v1/`) de ce repo, divergence assumée du reste de l'API (flat, non versionnée) car imposée par l'ADR lui-même. `:partnerType` restreint à `"apip"` pour cette story (autre valeur → 404) ; `:event` restreint à `"company-created"` (seul événement nommé par l'ADR).

**Décision sur l'organisation créée** : `regimeFiscal`/`legalForm` non transmis par APIP (webhook ne fournit que RCCM+NIF selon l'ADR) — valeurs par défaut les plus sûres à documenter explicitement (jamais un défaut serveur caché arbitraire) : `legalForm: "commercial"` (une entreprise formalisée via APIP est par nature une entité commerciale, jamais une association) et `regimeFiscal` laissé au choix ultérieur du futur owner — mais `Organization.regimeFiscal` n'est pas nullable dans le schema actuel (vérifié). Un défaut `normal_tva` serait arbitraire et potentiellement incorrect fiscalement. Décision : garder `regimeFiscal` requis au niveau DTO du webhook aussi — si APIP ne le transmet pas dans son payload réel, ce sera ajusté à l'intégration réelle ; pour cette story, le DTO l'exige explicitness (cohérent avec le fait qu'aucune valeur par défaut fiscale ne peut être injectée sans risque de non-conformité).

## Problème (en 3 lignes max)
Une PME qui vient de se formaliser auprès d'APIP n'a aucune organisation pré-créée sur facture.gn à son nom — `registrationSource` existe pour tracer ce canal d'acquisition mais rien ne le peuple jamais, et aucun mécanisme d'auto-création par webhook n'existe.

## Solution retenue (en 5 lignes max)
Nouveau modèle `Partner` (type/name/conventionRef/status). `PartnerWebhookAuthGuard` (nouveau) vérifie `X-Partner-Key` (égal à `APIP_WEBHOOK_SECRET`, comparaison à temps constant) ET `X-Partner-Signature` (HMAC-SHA256 du corps brut avec ce même secret). `POST /v1/partners/apip/company-created` crée l'organisation (`registrationSource: "apip"`, `commercialTier: "freemium"` déjà défaut, `dgiVerificationStatus: "unverified"` déjà défaut) SANS `OrganizationMember` (aucun owner tant que personne ne s'inscrit pour la revendiquer — hors scope de cette story). Idempotence via header `Idempotency-Key` (ADR-016, réutilise le pattern déjà établi ailleurs).

## Alternatives écartées
Table de clés partenaires en DB (multi-partenaires) — écartée, un seul partenaire (APIP) concerné au MVP, mirroir du pattern env-var-unique déjà établi 3 fois dans ce repo. SMS d'accueil — écartée, aucune infra de notification (C9 bloquée). Rate limiting — écartée, aucune infra dans ce repo.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — enum `PartnerType{apip,fodip,partner_3ae}`, `PartnerStatus{active,suspended,expired}`, modèle `Partner`, migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/common/partner-webhook-auth.guard.ts` (nouveau) — vérifie `X-Partner-Key` + `X-Partner-Signature` (HMAC-SHA256 du raw body)
- [ ] Tâche 3 : `apps/trust-api/src/organizations/dto/create-from-apip.dto.ts` (nouveau) — name, regimeFiscal, legalForm, nif (requis, pas optionnel — APIP transmet RCCM+NIF), rccm
- [ ] Tâche 4 : `organizations.service.ts` — nouvelle méthode `createFromApip(dto, idempotencyKey)` — anti-doublon par idempotencyKey (même pattern que `payments.service.ts`), organisation créée sans membre
- [ ] Tâche 5 : `apps/trust-api/src/partners/partners.controller.ts` + `partners.module.ts` (nouveaux) — `POST /v1/partners/:partnerType/:event`, `@Public()` + `@UseGuards(PartnerWebhookAuthGuard)`, valide `:partnerType === "apip"` et `:event === "company-created"`
- [ ] Tâche 6 : `apps/trust-api/.env.example` — `APIP_WEBHOOK_SECRET`

## Tests à écrire AVANT le code
- [ ] Test 1 (`partner-webhook-auth.guard.spec.ts`) : accepte une signature HMAC valide
- [ ] Test 2 : rejette une signature invalide ou absente
- [ ] Test 3 : rejette une `X-Partner-Key` incorrecte
- [ ] Test 4 (`organizations.service.spec.ts`) : `createFromApip()` crée l'organisation avec `registrationSource: "apip"`, sans `OrganizationMember`
- [ ] Test 5 : `createFromApip()` idempotent (même `idempotencyKey` → même résultat, pas de doublon)
- [ ] Test 6 (E2E réel) : webhook complet signature valide → organisation créée, `commercialTier: "freemium"`, `dgiVerificationStatus: "unverified"`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Migration Prisma appliquée
- code-reviewer OK
- security-reviewer OBLIGATOIRE (nouvelle authentification HMAC, premier webhook entrant partenaire de trust-api, surface d'attaque externe)

## Risques identifiés & mitigations
- Risque 1 : vérification HMAC incorrecte (timing attack sur la comparaison) → mitigation : `timingSafeEqual` (mirroir exact de `InternalAuthGuard` déjà 3 fois utilisé dans ce repo).
- Risque 2 : webhook rejoué (replay) sans idempotence → mitigation : `Idempotency-Key` obligatoire, même discipline que `payments.controller.ts`.
- Risque 3 : `X-Partner-Signature` calculée sur un body déjà parsé (JSON re-sérialisé) plutôt que le RAW body reçu → signature invalide même légitime, ou pire, contournable. Mitigation : NestJS `rawBody` doit être capturé AVANT le parsing JSON (`bodyParser: {verify: ...}` ou middleware dédié) — à vérifier précisément lors de l'implémentation.
