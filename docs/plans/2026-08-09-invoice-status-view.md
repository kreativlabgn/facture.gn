# Plan : Suivre le statut d'un paiement en temps réel (C10)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `invoices/` existant, aucun nouveau modèle
- Persona affecté : organisation (staff) qui veut vérifier où en est une facture (payée/partielle/en attente) sans attendre une notification
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun direct

## Investigation préalable
Backlog : "C10 — Suivre le statut d'un paiement en temps réel `[SHOULD]`." Aucun bullet, aucune réf ADR, aucun persona explicite — story la plus sparse rencontrée avec F6/F8.

**Découverte structurante** : `apps/trust-api/src/invoices/invoices.controller.ts` n'a **aucune route `@Get()`** — grep confirmé. Aucun moyen de consulter l'état d'UNE facture existe dans tout le Trust Context (seuls `GET /organizations/:id/trust-score`, `GET /verify/:certificationId` et `GET /organizations/:id/fec` existent, aucun n'étant une vue facture-par-facture). "Suivre le statut... en temps réel" présuppose structurellement de pouvoir LIRE l'état — ce prérequis n'existe pas.

**Décision de scope sur "temps réel"** : aucune infrastructure websocket/push n'existe dans ce repo (grep confirmé, aucun `@WebSocketGateway`). "Temps réel" est interprété honnêtement comme *jamais de valeur mise en cache* — chaque appel relit l'état actuel depuis la DB (déjà le comportement par défaut de toute lecture Prisma dans ce repo) — le "temps réel" devient un problème de fréquence de polling côté client, jamais un mécanisme serveur à construire ici. Cohérent avec le principe déjà appliqué pour F7 ("le switch reste un problème client").

**Décision de scope sur l'autorisation** : accès restreint aux membres de l'organisation (mêmes rôles que `POST /invoices` : `owner`/`admin`/`accountant_internal`/`cashier`/`field_agent`) — réutilise `@Roles()` + l'idSource `"invoice"` déjà par défaut dans `RolesGuard` pour `:id`, **aucune extension de guard**. L'accès cabinet via mandat (comme F9/FEC) n'est **volontairement pas ajouté ici** — aucun signal backlog ne relie C10 à l'écosystème cabinet, ce serait une extension de mon invention plutôt qu'une demande ; si le besoin se confirme, story future distincte (même discipline que les exclusions déjà actées cette session).

## Problème (en 3 lignes max)
Une organisation ne peut consulter l'état d'aucune facture via l'API — seules des actions de mutation existent (`POST`), jamais une lecture, rendant impossible tout suivi de statut sans requêter la DB directement.

## Solution retenue (en 5 lignes max)
`GET /invoices/:id` — retourne la facture telle qu'elle existe actuellement en DB (`status`, `amountDue`, `amountPaid`, `paymentLinkUrl`, etc.), sans transformation. `@Roles("owner","admin","accountant_internal","cashier","field_agent")` (même trio élargi que `POST /invoices`), aucun changement à `RolesGuard` (idSource `"invoice"` déjà le défaut). 404 explicite si la facture n'existe pas ou n'appartient pas à l'organisation de l'appelant (résolution déjà garantie par `RolesGuard`).

## Alternatives écartées
Mécanisme websocket/push pour un vrai temps réel — écartée, aucune infrastructure de ce type dans ce repo, disproportionné pour une story SHOULD sans signal backlog précis. Accès cabinet via mandat (comme F9) — écartée, aucun signal backlog reliant C10 à l'écosystème cabinet ; extension future si confirmée, pas une invention maintenant.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/invoices/invoices.service.ts` — ajoute `findOne(invoiceId)` : `findUniqueOrThrow`, 404 si absent
- [ ] Tâche 2 : `apps/trust-api/src/invoices/invoices.controller.ts` — ajoute `GET :id`, réutilise `@Roles()` existant

## Tests à écrire AVANT le code
- [ ] Test 1 (`invoices.service.spec.ts`) : retourne la facture telle qu'elle existe en DB
- [ ] Test 2 : lève 404 si la facture n'existe pas

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune migration Prisma nécessaire
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : aucun — extension triviale d'un pattern déjà entièrement établi (`RolesGuard`, idSource `"invoice"` par défaut).
