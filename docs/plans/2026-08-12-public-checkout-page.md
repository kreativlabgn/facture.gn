# Plan : Page de pré-checkout publique (C19)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Money Context (`apps/money-api`, nouvelle route publique + 2 champs sur `PaymentProviderAttempt`, propriété d'écriture exclusive déjà établie) + frontend (`apps/web`, nouvelle page publique, aucune session requise).
- Persona affecté : le PAYEUR (client final d'une PME facture.gn), pas nécessairement un utilisateur inscrit — c'est la première page de ce repo destinée à quelqu'un qui n'a jamais de compte facture.gn.
- Données sensibles : montant + frais gateway d'une facture précise — même sensibilité que `GET /verify/:certificationId` (déjà public), pas de donnée client/organisation exposée.
- Impact réglementaire : aucun direct, mais C19 `[MUST]` — "ne jamais laisser le payeur découvrir les frais chez le provider" est un principe de transparence déjà énoncé par l'utilisateur.

## Investigation préalable

`paymentLinkUrl` (ex. `https://stub.djomy.africa/pay/...`) est généré par `PaymentProviderRegistryService.resolve()` (money-api) et renvoyé une seule fois à `trust-api` (`PaymentLinkClient.tryGenerate()`), qui persiste `Invoice.paymentLinkUrl` — mais **`feeGatewayGnf` est calculé par money-api puis silencieusement jeté** par `PaymentLinkClient` (jamais capturé dans son type de retour `PaymentLinkResult`, jamais stocké nulle part) — c'est exactement le gap C19.

`PaymentProviderRegistryService.recordAttempt()` persiste déjà `PaymentProviderAttempt` (`feeGateway`, `providerRef`, `amountGnf`, `invoiceId`, `status`) à chaque tentative — **propriété d'écriture exclusive de money-api** (commentaire du schema). Il lui manque seulement `paymentLinkUrl` et `expiresAt` (actuellement seulement transitoires dans `CreatePaymentLinkResult`, jamais persistés) pour que money-api puisse répondre seul à un checkout public, sans jamais interroger trust-api depuis le frontend (respect strict de la séparation des bounded contexts — le frontend n'a pas à appeler deux services pour un seul écran).

Aucun guard global sur `apps/money-api` (`app.module.ts` n'a pas d'`APP_GUARD`, contrairement à trust-api) — chaque contrôleur applique `@UseGuards(InternalAuthGuard)` lui-même. Une route publique = simplement l'absence de ce guard sur cette méthode précise.

## Décision d'architecture

**`PaymentProviderAttempt`** (`packages/db/prisma/schema.prisma`) : + `paymentLinkUrl String?`, `expiresAt DateTime?`. Migration manuelle (pas de DB locale démarrée).

**`PaymentProviderRegistryService.recordAttempt()`** : persiste ces deux champs depuis `result` (déjà disponibles, jamais transmis jusqu'ici).

**`PaymentLinksController`** (money-api) : le guard `@UseGuards(InternalAuthGuard)`, actuellement au niveau classe, descend au niveau de la méthode `create()` uniquement. Nouvelle méthode `GET /payment-links/:invoiceId/checkout` — **aucun guard**, publique :
- `PaymentLinksService.getPublicCheckout(invoiceId)` → dernière tentative `status: "success"` pour cet `invoiceId` (`findFirst`, `orderBy: createdAt desc`) ; 404 explicite si aucune (jamais une réponse vide silencieuse — le payeur doit comprendre "aucun lien actif" plutôt qu'un écran cassé).
- Réponse : `{ provider, paymentLinkUrl, amountGnf, feeGatewayGnf, expiresAt }` — strictement ces champs, jamais `invoiceId`/`organizationId` (déjà connus du payeur via son SMS/lien, pas une fuite mais pas un ajout nécessaire non plus).

**Frontend** — `apps/web/src/lib/money-api.ts` (nouveau fichier, distinct de `trust-api.ts` : bounded context différent, jamais mélangés) : `fetchPublicCheckout(invoiceId)`, appel direct sans token (page publique, l'utilisateur n'est pas authentifié). `apps/web/src/app/pay/[invoiceId]/page.tsx` : affiche montant facture, frais gateway, total payeur, bouton "Payer" → redirige vers `paymentLinkUrl`. Lien expiré (`expiresAt < now`) → message explicite, pas de bouton.

**Câblage du lien envoyé au payeur** : hors scope strict de cette tâche (voir tâche suivante `payment-link-notifications`, C9) — cette page doit exister et fonctionner par URL directe (`/pay/:invoiceId`) avant que quoi que ce soit ne l'envoie automatiquement.

## Alternatives écartées

**Stocker le fee sur `Invoice` (trust-api) plutôt que sur `PaymentProviderAttempt` (money-api)** — écartée : le fee gateway est une donnée Money Context par nature (dépend du provider, de son barème) — la faire traverser vers Trust Context violerait la séparation déjà établie ("Propriété d'écriture exclusive de money-api" pour cette table). Le frontend interroge money-api directement pour cet écran précis, exactement comme il interroge trust-api directement pour la vérification publique.

**Réutiliser `paymentLinkUrl` du provider comme SEULE page de checkout (pas de pré-checkout facture.gn)** — écartée par l'utilisateur (décision déjà actée) : le provider (Djomy/Moneroo, encore des stubs) n'a aucune garantie d'afficher les frais de façon transparente.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `schema.prisma` — `PaymentProviderAttempt.paymentLinkUrl`/`.expiresAt`, migration
- [ ] Tâche 2 (RED) : `provider-registry.service.spec.ts` — `recordAttempt` persiste `paymentLinkUrl`/`expiresAt` sur succès
- [ ] Tâche 3 (GREEN) : `provider-registry.service.ts` mis à jour
- [ ] Tâche 4 (RED) : `payment-links.service.spec.ts` — `getPublicCheckout()` : retourne la dernière tentative réussie ; 404 si aucune ; ignore les tentatives `failed`/`timeout`
- [ ] Tâche 5 (GREEN) : `PaymentLinksService.getPublicCheckout()`, route contrôleur sans guard
- [ ] Tâche 6 : `apps/web/src/lib/money-api.ts`, `pay/[invoiceId]/page.tsx`

## Critères de done
- Suite money-api verte, suite web verte, typecheck/lint/build verts des deux côtés
- Un `invoiceId` sans tentative réussie retourne 404, jamais un écran cassé
- Un lien expiré n'affiche aucun bouton "Payer" actionnable

## Risques identifiés & mitigations
- Risque 1 : `GET /payment-links/:invoiceId/checkout` publique pourrait devenir un vecteur d'énumération de factures → mitigation : la réponse ne contient que montant/frais/lien déjà légitimement connus du payeur détenteur du lien, même sensibilité que la vérification publique déjà en place ; pas de nom de client ni d'organisation exposé par cette route.
- Risque 2 : plusieurs tentatives réussies pour la même facture (edge case non attendu en pratique, un seul provider gagne normalement) → mitigation : `orderBy createdAt desc` + `take 1`, toujours la plus récente, comportement déterministe même dans ce cas.
