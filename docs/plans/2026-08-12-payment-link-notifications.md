# Plan : Envoi du lien de paiement par SMS/WhatsApp (C9)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : ambigu par construction — voir "Placement architectural" ci-dessous. Implémenté dans `apps/trust-api/src/notifications/` (approximation MVP assumée et documentée, pas un choix architectural définitif).
- Persona affecté : le client final (payeur) qui reçoit le lien ; la PME qui choisit le canal de notification de chacun de ses clients.
- Données sensibles : numéro de téléphone du client (déjà stocké, `Customer.phone`), contenu du message (montant, lien de paiement).
- Impact réglementaire : aucun direct.

## Investigation préalable

Backlog (texte exact) : *"C9 — Envoyer le lien (WhatsApp/SMS) `[MUST]`"* (une seule ligne, comme G2). Aucun module de notification n'existe dans tout le repo (`grep -rn "sms\|whatsapp" apps/*/src` hors ce plan : zéro résultat pertinent). C20 (`payment_link_auto_send`, déjà mergé) ne fait que contrôler si le lien est GÉNÉRÉ immédiatement ou différé — il n'envoie jamais rien à personne, contrairement à ce que son nom pourrait laisser penser.

**Placement architectural — tension assumée** : `context-facture-gn` classe "notifications" dans le Platform Context (Squad Platform), non scaffoldé dans ce repo (seuls `apps/trust-api`, `apps/money-api`, `apps/web` existent). Or l'envoi a besoin du téléphone du client (`Customer.phone`, Trust Context) ET du lien de paiement (généré côté Money Context mais déjà rapatrié sur `Invoice.paymentLinkUrl` côté trust-api à l'émission). Créer un 4e service pour une seule story serait disproportionné à ce stade (aucune autre notification n'existe encore pour justifier un service dédié — "règle des trois" non atteinte). Décision : module `notifications/` DANS `apps/trust-api`, déclenché en meilleur effort juste après la génération du lien de paiement dans `InvoicesService.issue()` — même point d'insertion que le lien lui-même. Documenté explicitement comme approximation MVP (même discipline que `StubEd25519CertificationService`, `chiffrement enveloppe` local) : à extraire vers un vrai Platform Context si/quand d'autres notifications apparaissent.

`InvoicesService.issue()` a déjà `issuedInvoice.customerId` disponible (C6) à l'endroit exact où le lien de paiement est confirmé — point d'insertion naturel, aucune requête supplémentaire structurante.

## Décision d'architecture

**`Customer.notificationChannel`** (nouvel enum `NotificationChannel { sms whatsapp both }`, `@default(sms)`) — "choix par l'utilisateur" (décision utilisateur) : la PME choisit, par client, comment ce client reçoit ses liens de paiement. Exposé dans `create-customer.dto.ts` (optionnel, défaut serveur) et le formulaire `NewCustomerForm` (dashboard PME).

**Interface `NotificationProvider`** (`notifications/notification-provider.interface.ts`) : `send(phone: string, message: string): Promise<{ success: boolean }>` — même forme que `PaymentProvider` (money-api), pas une coïncidence : deux stubs, `SmsStubProvider`/`WhatsAppStubProvider`, mêmes limites qu'ADR-073 (aucun SDK/compte réel disponible en environnement de dev, stub loggé plutôt qu'un envoi simulé silencieux).

**`PaymentLinkNotificationService.notify(customer, paymentLinkUrl, totalGnf)`** : compose un message court (montant + lien), dispatch vers `sms`/`whatsapp`/les deux selon `customer.notificationChannel`. **Ne lève jamais** — même garantie "meilleur effort" que la génération du lien elle-même (`PaymentLinkClient.tryGenerate()`) : un échec d'envoi ne doit jamais faire échouer une émission déjà certifiée.

**`InvoicesService.issue()`** : après la mise à jour réussie de `paymentLinkUrl` sur la facture, si `issuedInvoice.customerId` existe, charge le `Customer`, et si `customer.phone` existe, appelle `notificationService.notify(...)` en meilleur effort (try/catch local, log un warning en cas d'échec, jamais propagé).

## Alternatives écartées

**Scaffolder un vrai `apps/platform-api`** — écarté pour cette story : disproportionné pour une seule feature, aucun autre besoin Platform Context présent dans ce repo pour justifier un 4e service maintenant. Documenté comme dette technique assumée.

**Canal fixé au niveau organisation plutôt que par client** — écarté : le backlog ne donne aucun signal pour ce niveau, et un client donné a un moyen de contact réel (WhatsApp ou pas) indépendant des autres clients de la même PME — le niveau `Customer` est le niveau correct du point de vue métier.

**Bloquer l'émission si l'envoi échoue** — écarté catégoriquement, même raisonnement que C2/C18 (Parcours Fanta : cash et lien ne s'excluent jamais l'un l'autre).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `schema.prisma` — enum `NotificationChannel`, `Customer.notificationChannel`, migration
- [ ] Tâche 2 (RED) : `notification-providers.spec.ts` — `SmsStubProvider`/`WhatsAppStubProvider` retournent `{success: true}`, loggent l'envoi
- [ ] Tâche 3 (GREEN) : les deux providers stub
- [ ] Tâche 4 (RED) : `payment-link-notification.service.spec.ts` — dispatch sms/whatsapp/both selon le canal ; ne lève jamais même si le provider échoue
- [ ] Tâche 5 (GREEN) : `PaymentLinkNotificationService`
- [ ] Tâche 6 (RED) : `invoices.service.spec.ts` — `issue()` notifie le client si téléphone présent ; ne notifie jamais si le lien de paiement a échoué ou si le client n'a pas de téléphone ; l'échec de notification ne fait jamais échouer `issue()`
- [ ] Tâche 7 (GREEN) : câblage dans `InvoicesService.issue()`
- [ ] Tâche 8 : `create-customer.dto.ts`, `customers.service.ts`, `NewCustomerForm.tsx` — choix du canal à la création d'un client

## Critères de done
- Suite trust-api verte, suite web verte, typecheck/lint/build verts
- Un client sans téléphone n'entraîne aucune tentative d'envoi (pas d'erreur, pas de log bruyant)
- `issue()` reste `status: "issued"` même si toute la chaîne de notification échoue

## Risques identifiés & mitigations
- Risque 1 : placement dans Trust Context contredit la classification Platform Context du contexte métier → mitigation : documenté explicitement ci-dessus comme dette technique assumée, pas une divergence silencieuse.
- Risque 2 : numéro de téléphone loggé en clair par les stubs → mitigation : logs de stub tronquent le numéro (mêmes 4 derniers chiffres visibles uniquement), même discipline que les autres secrets/PII de ce repo.
