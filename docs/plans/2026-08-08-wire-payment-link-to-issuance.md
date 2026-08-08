# Plan : Câbler la génération du lien de paiement à l'émission (C2, Phase 2a)

## Contexte facture.gn
- Bounded context : Trust Context (`invoices.service.ts` étendu) **et** Money Context (nouveau guard d'authentification interne sur `money-api`) — deux services distincts, jamais fusionnés
- Persona affecté : toute organisation émettant une facture — le lien de paiement apparaît désormais automatiquement à l'émission (ou reste absent en cas de panne `money-api`, jamais bloquant)
- Données sensibles manipulées : nouveau secret partagé inter-service (`MONEY_API_INTERNAL_KEY`), montants (déjà traités avec rigueur ailleurs)
- Impact réglementaire : aucun nouveau — respecte les SLA déjà fixées (DAT §12)

## Problème (en 3 lignes max)

`apps/money-api` (Phase 1) est un service autonome que personne n'appelle : la promesse backlog C2 ("lien généré à l'émission, résolu par l'orchestrateur") n'est pas tenue tant que `invoices.service.ts.issue()` ne le déclenche pas. Sans câblage, l'orchestrateur Djomy/Moneroo construit en Phase 1 reste une coquille vide.

## Solution retenue (en 5 lignes max)

`issue()` certifie et committe la facture **d'abord**, exactement comme aujourd'hui — jamais couplé à la génération de lien. Un nouveau `PaymentLinkClient` (module `money-client`, `trust-api`) tente ensuite un appel HTTP vers `money-api` avec un timeout **court et propre côté trust-api** (3s, `AbortController`, natif Node 20, aucune nouvelle dépendance) — distinct du timeout interne 10s+retries de `money-api`. Succès → second `update()` mineur peuplant `paymentLinkUrl`/`paymentLinkId`/`paymentLinkExpiresAt` (champs déjà existants). Échec/timeout → loggé (`Logger.warn`, jamais silencieux) mais **ne fait jamais échouer l'émission** — cohérent avec le Parcours Fanta déjà documenté ("les deux modes [cash et lien] ne s'excluent jamais l'un l'autre") et la story C18 (régénération de lien) qui donne la légitimité produit à ce choix. Authentification inter-service par clé partagée simple (header `X-Internal-Api-Key`, comparaison à temps constant `crypto.timingSafeEqual`, fail-fast au démarrage si absente côté `money-api` — même pattern que `JWT_PRIVATE_KEY`/`CERTIFICATION_PRIVATE_KEY`).

## Alternatives écartées

- **Appel synchrone bloquant, `issue()` attend la résolution complète de l'orchestrateur** : écarté — le circuit breaker Djomy (10s dur) + retry Moneroo x2 (jusqu'à 10s chacun) donnent un pire cas ~30s, violant directement le SLA "Émission facture < 2s" (DAT §12) et le principe d'isolation des pannes (DAT §2) : une panne Money Context ne doit jamais rendre l'émission de facture elle-même inutilisable.
- **File d'attente asynchrone (BullMQ/Redis)** : écarté pour ce plan — aucune infra Redis/BullMQ scaffoldée dans ce repo (cohérent avec la décision déjà prise pour l'idempotence de C1). Le pattern "meilleur effort avec timeout court, jamais bloquant" atteint le même objectif de découplage sans nouvelle brique d'infra.
- **mTLS pour l'authentification inter-service** : écarté — aucune infrastructure de certificats dans ce repo, disproportionné pour un premier lien entre deux services sur réseau privé contrôlé. Clé partagée simple, à durcir si un jour justifié.
- **HMAC-SHA256 du corps de requête (pattern ADR-082, webhooks partenaires)** : écarté — ADR-082 protège un webhook **entrant** depuis un tiers non fiable (intégrité du corps sur un réseau non maîtrisé). Ici c'est un appel **sortant** de trust-api vers un service qu'on contrôle entièrement — une clé partagée simple suffit, complexité disproportionnée sinon.

## Découpage en tâches bite-sized (2–5 min chacune)

- [ ] Tâche 1 : `apps/money-api/src/common/internal-auth.guard.ts` — `InternalAuthGuard`, lit `MONEY_API_INTERNAL_KEY` au constructeur (fail-fast si absent), compare via `crypto.timingSafeEqual` (jamais `===` sur un secret)
- [ ] Tâche 2 : `apps/money-api/src/payment-links/payment-links.controller.ts` — `@UseGuards(InternalAuthGuard)` sur le contrôleur
- [ ] Tâche 3 : `apps/money-api/.env.example` — nouvelle variable `MONEY_API_INTERNAL_KEY`, instruction de génération (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] Tâche 4 : `apps/trust-api/src/money-client/payment-link-client.ts` — `PaymentLinkClient.tryGenerate(request)`, jamais de throw, retourne `null` sur tout échec (réseau, timeout, non-2xx), loggé via `Logger.warn`
- [ ] Tâche 5 : `apps/trust-api/src/money-client/money-client.module.ts`
- [ ] Tâche 6 : `apps/trust-api/src/invoices/invoices.service.ts` — `issue()` étendu : après le commit de certification, appelle `PaymentLinkClient.tryGenerate()`, second `update()` si succès, retourne la facture (avec ou sans lien)
- [ ] Tâche 7 : `apps/trust-api/.env.example` — `MONEY_API_URL`, `MONEY_API_INTERNAL_KEY` (même valeur que côté money-api, généré une fois)
- [ ] Tâche 8 : `apps/trust-api/src/app.module.ts` — enregistrer `MoneyClientModule`

## Tests à écrire AVANT le code

- [ ] Test 1 : `internal-auth.guard.spec.ts` — refuse (401) une clé absente ou incorrecte ; autorise la clé exacte ; lève au constructeur si `MONEY_API_INTERNAL_KEY` n'est pas configuré
- [ ] Test 2 : `payment-link-client.spec.ts` — retourne le lien sur une réponse 2xx (fetch mocké) ; retourne `null` (jamais de throw) sur une réponse non-2xx, sur un timeout simulé, sur une exception réseau
- [ ] Test 3 : `invoices.service.spec.ts` (étendu) — `issue()` peuple `paymentLinkUrl`/`paymentLinkId`/`paymentLinkExpiresAt` quand `PaymentLinkClient.tryGenerate()` réussit
- [ ] Test 4 : `invoices.service.spec.ts` (étendu) — `issue()` réussit et retourne la facture certifiée **normalement** quand `PaymentLinkClient.tryGenerate()` retourne `null` (panne Money Context) — jamais un échec d'émission à cause de ça
- [ ] Test 5 : `invoices.service.spec.ts` (étendu) — la certification (numéro, hash, signature) est strictement identique que le lien de paiement réussisse ou échoue — aucun couplage entre les deux

## Critères de done

- [ ] Tous les tests verts (`pnpm turbo lint typecheck test`)
- [ ] Vérification E2E réelle : émettre une facture avec `money-api` up → `paymentLinkUrl` peuplé ; émettre une facture avec `money-api` down (process arrêté) → émission réussit quand même, `paymentLinkUrl` reste `null`, aucun ralentissement perceptible de l'émission
- [ ] Mesure du temps de réponse de `issue()` avec `money-api` down — doit rester largement sous les 2s (pas d'attente du timeout complet de 3s si l'échec est un refus de connexion immédiat, mais vérifier le pire cas réseau)
- [ ] Aucune régression sur `organizations`, `verify`, `payments` (C1)
- [ ] `dev-code-reviewer` puis `dev-security-reviewer` passés sur le diff (nouveau secret inter-service)

## Risques identifiés & mitigations

- Risque 1 : le timeout de 3s côté `trust-api` s'additionne quand même de façon perceptible si testé en pire cas (connexion qui traîne sans refuser ni timeout réseau OS) → mitigation : `AbortController` avec délai strict, testé explicitement (Test 2, timeout simulé)
- Risque 2 : `MONEY_API_INTERNAL_KEY` divergente entre les deux `.env` (trust-api génère une valeur, money-api en attend une autre) → mitigation : README documente qu'il s'agit d'une seule et même valeur à copier entre les deux services, pas deux générations indépendantes
- Risque 3 : la seconde requête `update()` sur l'invoice (après coup, pour le lien) pourrait échouer silencieusement si la facture a été modifiée entre-temps (race avec un autre appelant) → mitigation : hors scope réaliste pour ce plan (l'update ne touche que 3 champs jamais modifiés ailleurs à ce stade du cycle de vie), mais si l'update lève, il ne doit pas non plus faire échouer `issue()` — même try/catch défensif que l'appel HTTP
- Risque 4 : oubli du guard sur le contrôleur, `money-api` resterait ouvert sans authentification → mitigation : Test explicite confirmant le guard est bien appliqué (401 sans clé), vérifié aussi en HTTP réel

## Vérification bout-en-bout prévue

Démarrer `money-api` et `trust-api` ensemble, `MONEY_API_INTERNAL_KEY` identique des deux côtés → émettre une facture → `paymentLinkUrl` peuplé, provider visible. Arrêter `money-api` → émettre une nouvelle facture → succès malgré tout, `paymentLinkUrl` reste `null`, temps de réponse de `issue()` mesuré et resté raisonnable. Tester aussi une clé interne incorrecte → confirmer 401 côté `money-api` et que `trust-api` gère ça comme un échec silencieux (pas de crash de l'émission).
