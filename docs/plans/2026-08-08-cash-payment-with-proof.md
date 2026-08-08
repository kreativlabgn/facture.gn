# Plan : Encaisser en cash avec preuve (C1)

## Contexte facture.gn
- Bounded context : Trust Context (Squad Trust) — décision actée : le modèle `Payment` est introduit ici, réutilisé tel quel par le Money Context (C2, orchestrateur Djomy/Moneroo) qui sera bâti séparément
- Persona affecté : toute organisation encaissant du cash, en particulier `delivery_driver` (paiement à la livraison, Parcours-UX Fanta) et `cashier`/`field_agent`
- Données sensibles manipulées : montants (déjà traités avec rigueur ailleurs dans le repo), coordonnées GPS d'un encaissement — aucun PIN/NIF ici
- Impact réglementaire : OHADA/SYSCOHADA (le paiement alimente `amount_paid`/`amount_due`, base de l'export FEC) ; LBC/FT indirectement (ADR-032/091 — hors scope de ce plan, la détection comportementale G3 est un chantier séparé)

## Problème (en 3 lignes max)

Aucun mécanisme n'existe pour enregistrer un encaissement cash contre une facture émise : `invoice.amountPaid`/`amountDue` existent en base mais rien ne les met à jour, et la machine à états `issued → partially_paid → paid` (ADR-062) n'est câblée nulle part. Sans preuve (photo/GPS/signature) au-delà d'1M GNF, un encaissement cash n'a aucune trace vérifiable — risque direct de contournement de la certification.

## Solution retenue (en 5 lignes max)

Nouveau modèle `Payment` (méthode `cash` uniquement pour ce plan — `bank_transfer`/`payment_link` restent des stories séparées, C2/C3), avec champs de preuve nullable (`proofPhotoUrl`, `proofGpsLat`, `proofGpsLng`, `proofSignature`) rendus obligatoires par validation Zod (`.refine()`) uniquement si `amount > 100_000_000` centimes (1M GNF, seuil en dur — `CONFIG_PARAMETER` versionné est un chantier V1 non scaffoldé). `PaymentsService.recordCashPayment()` crée le `Payment` et met à jour `Invoice.amountPaid`/`amountDue`/`status` dans une seule transaction Prisma (jamais d'incohérence entre les deux). Idempotence via contrainte unique DB sur `idempotencyKey` (header `Idempotency-Key` obligatoire) : un replay renvoie le paiement déjà créé au lieu d'en recréer un second — pas de Redis nécessaire pour le MVP.

## Alternatives écartées

- **Gérer l'upload du fichier photo dans ce service (multipart, MinIO)** : écarté — MinIO n'est pas scaffoldé dans ce repo (aucune trace dans le code), et c'est une brique d'infra transverse, pas spécifique à ce paiement. Le service accepte une URL de preuve déjà uploadée côté client (PWA/mobile), cohérent avec le principe déjà appliqué à Djomy/Moneroo (dépendance externe non disponible = pas bloquant pour livrer le reste, scope isolé proprement).
- **Redis pour l'idempotence (ADR-016 tel quel)** : écarté pour ce plan — pas de Redis dans le repo actuellement. Une contrainte unique Postgres sur `idempotencyKey` avec lookup-avant-insert donne la même garantie fonctionnelle (pas de double comptage d'un paiement) sans nouvelle dépendance d'infra. Migration vers Redis TTL 24h restera pertinente uniquement si le volume l'exige.
- **Modéliser `method` avec les 3 valeurs `cash`/`payment_link`/`bank_transfer` actives dès ce plan** : écarté — le backlog scope C1 au cash strictement (`bank_transfer` = C3, SHOULD, distinct ; `payment_link` = C2, gros chantier séparé). L'enum Prisma inclut les 3 valeurs (cohérence ERD long terme) mais le DTO/service de ce plan n'accepte que `method: "cash"`, rejette explicitement les autres avec un message clair plutôt qu'un comportement silencieusement non implémenté.
- **CONFIG_PARAMETER table versionnée pour `cash_proof_threshold_gnf`** : écarté pour ce plan — table absente du schéma actuel (6 entités bootstrappées), en introduire une seule pour un seul paramètre serait prématuré. Constante en dur documentée, migration vers `CONFIG_PARAMETER` quand d'autres paramètres (déjà listés au DAT §config) en auront besoin aussi.

## Découpage en tâches bite-sized (2–5 min chacune)

- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — enum `PaymentMethod` (cash/payment_link/bank_transfer), enum `PaymentStatus` (pending/completed/failed), modèle `Payment` (id, invoiceId FK, amount, amountCollected, platformFeeAmount, gatewayFeeAmount, method, providerSubMethod nullable, depositType nullable, providerRef nullable, status, idempotencyKey unique, proofPhotoUrl/proofGpsLat/proofGpsLng/proofSignature nullable, collectedAt)
- [ ] Tâche 2 : migration Prisma (`prisma migrate diff` + fichier manuel + `migrate deploy`, même procédure que le sprint précédent faute de TTY interactif)
- [ ] Tâche 3 : `apps/trust-api/src/payments/dto/create-payment.dto.ts` — schéma Zod : `invoiceId`, `amount` (string→bigint), `method` (littéral `"cash"` pour ce plan), `proofPhotoUrl`/`proofGpsLat`/`proofGpsLng`/`proofSignature` optionnels, `.refine()` : tous obligatoires ensemble si `amount > 100_000_000n`
- [ ] Tâche 4 : `apps/trust-api/src/payments/payments.service.ts` — `recordCashPayment(dto, idempotencyKey)` : lookup idempotence (retourne l'existant si trouvé) ; rejette si facture introuvable (404), si statut ∉ {issued, partially_paid} (409), si `amount` > `amountDue` restant (409, pas de sur-paiement silencieux — cohérent avec `overpaymentAmount` réservé au cash uniquement mais hors scope de ce plan, donc on bloque plutôt que d'improviser une règle) ; transaction Prisma : crée `Payment(status: completed, platformFeeAmount: 0, gatewayFeeAmount: 0)`, met à jour `Invoice.amountPaid += amount`, `amountDue -= amount`, `status` (paid si amountDue atteint 0, sinon partially_paid)
- [ ] Tâche 5 : `apps/trust-api/src/payments/payments.controller.ts` — `POST /payments`, `@Roles(owner, admin, cashier, field_agent, delivery_driver)`, header `Idempotency-Key` (UUID v4) obligatoire, 400 explicite si absent/mal formé
- [ ] Tâche 6 : `apps/trust-api/src/payments/payments.module.ts` + enregistrement dans `app.module.ts`

## Tests à écrire AVANT le code

- [ ] Test 1 : `create-payment.dto.spec.ts` — rejette `amount` > 1M GNF sans `proofPhotoUrl`/`proofGpsLat`/`proofGpsLng`/`proofSignature` ; accepte le même montant avec les 4 champs présents ; accepte un montant ≤ 1M GNF sans aucune preuve
- [ ] Test 2 : `payments.service.spec.ts` — `recordCashPayment()` sur une facture `issued` dont `amount` = `amountDue` exact → `Invoice.status` passe à `paid`, `amountDue` à 0
- [ ] Test 3 : `payments.service.spec.ts` — `recordCashPayment()` avec `amount` < `amountDue` → `Invoice.status` passe à `partially_paid`, `amountDue` diminue du montant payé
- [ ] Test 4 : `payments.service.spec.ts` — rejette (409) un `amount` > `amountDue` restant
- [ ] Test 5 : `payments.service.spec.ts` — rejette (409) un paiement sur une facture `draft` ou `voided`
- [ ] Test 6 : `payments.service.spec.ts` — un replay avec le même `idempotencyKey` renvoie le `Payment` déjà créé, ne crée pas de second enregistrement, ne double-incrémente pas `amountPaid`
- [ ] Test 7 : `payments.service.spec.ts` — `platformFeeAmount`/`gatewayFeeAmount` toujours à 0 pour un paiement cash (commission = 0%, C1)

## Critères de done

- [ ] Tous les tests verts (`pnpm turbo lint typecheck test`)
- [ ] Migration Prisma appliquée proprement, `prisma migrate status` propre
- [ ] Vérification E2E réelle : émettre une facture, encaisser en cash sous le seuil (sans preuve), encaisser en cash au-dessus du seuil (avec preuve) sur une autre facture, vérifier `GET /verify/:certificationId` reflète bien le nouveau statut (`paid`/`partially_paid`)
- [ ] Aucune régression sur `invoices`, `organizations`, `verify`, `auth`
- [ ] `dev-code-reviewer` passé sur le diff

## Risques identifiés & mitigations

- Risque 1 : double comptage d'un paiement si le client retente une requête réseau échouée → mitigation : idempotence par contrainte unique DB sur `idempotencyKey`, testée explicitement (Test 6)
- Risque 2 : sur-paiement cash silencieux (le marchand encaisse plus que dû) laissant `amountDue` négatif → mitigation : rejet explicite (409) plutôt qu'une règle de trop-perçu improvisée (C14, trop-perçu cash, est une story SHOULD distincte du backlog, hors scope ici)
- Risque 3 : incohérence entre `Payment` créé et `Invoice.amountPaid` non mis à jour si l'un des deux échoue → mitigation : les deux dans la même transaction Prisma (`$transaction`), même pattern que `OrganizationsService.create()` et `InvoicesService.issue()`
- Risque 4 : le seuil de preuve en dur (100 000 000 centimes) diverge silencieusement de `cash_proof_threshold_gnf` si ce paramètre est un jour rendu configurable ailleurs → mitigation : constante nommée et commentée avec référence explicite au DAT, facilement grep-able pour migration future vers `CONFIG_PARAMETER`

## Vérification bout-en-bout prévue

Émettre une facture de 500 000 GNF (sous le seuil) → encaisser en cash sans preuve → `paid`. Émettre une facture de 1 500 000 GNF (au-dessus du seuil) → tenter un encaissement sans preuve → 400 ; encaisser avec les 4 champs de preuve → `paid`. Rejouer la même requête avec le même `Idempotency-Key` → même `Payment` renvoyé, `amountPaid` inchangé au second appel.
