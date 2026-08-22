# Plan : Recevoir un rappel automatique après échéance dépassée (I2, SHOULD)

## Contexte projet
- Module : Trust Context — `apps/trust-api/src/invoices/` (déclenchement), `apps/trust-api/src/notifications/` (envoi)
- Persona affecté : le client de la PME (destinataire du rappel), déclenché par owner/admin/cashier
- Données sensibles manipulées : numéro de téléphone client (déjà traité avec la même rigueur ailleurs, ex. `PaymentLinkNotificationService`), aucune nouvelle catégorie de donnée
- Impact réglementaire : aucun

## Clarifications
- Q: Aucune notion d'"échéance"/due date n'existe dans le schéma ni l'ERD/ADR — quelle définition retenir ? → R : une facture `issued`/`partially_paid` est "en retard" 30 jours après `issuedAt` (pas de champ `dueDate` séparé — l'ERD n'en a jamais eu). Seul point d'ancrage documentaire trouvé : Grille-Offres-facture-gn.md §3.1 (analytics Freemium/Starter) liste déjà "factures en retard > 30 jours" comme concept produit existant, jamais implémenté ailleurs. Constante nommée `OVERDUE_THRESHOLD_DAYS = 30`, pas un champ configurable par organisation (même précédent que `DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD`, E5 — pas de CONFIG_PARAMETER générique, ADR-058 jamais scaffoldée).
- Q: Déclenchement automatique (cron) ou manuel ? → R : manuel exclusivement (`POST /invoices/:id/send-reminder`) — aucune infra de cron dans ce repo, même descoping déjà accepté pour H4/I1. Le mot "automatique" du titre backlog décrit l'expérience CLIENT (il reçoit un rappel sans avoir à le demander), pas le déclenchement serveur — la PME déclenche, le client reçoit.
- Q: Un seul invoice ou un lot ? → R : un seul, symétrique à `regeneratePaymentLink()` (C18) — même famille d'action "à la demande" sur une facture précise. Un endpoint de lot introduirait des décisions de pagination/plafond non demandées par le backlog (une seule ligne, aucun critère d'acceptation) ; hors scope, non construit.
- Q: **Correction d'une hypothèse de contexte inexacte** — `PaymentLinkNotificationService.notify()` n'est PAS une méthode générique `notify(customer, message)` comme supposé initialement : sa signature réelle est `notify(customer, paymentLinkUrl, totalGnf)`, avec un message "facture prête" câblé en dur. Décision : extraire la logique de sélection de canal (SMS/WhatsApp/both) dans une fonction pure partagée `resolveNotificationProviders()` (`apps/trust-api/src/notifications/notification-dispatch.ts`), réutilisée par `PaymentLinkNotificationService` (refactor non-régressif, tests existants revérifiés) ET par un nouveau `PaymentReminderService` — jamais dupliquer la logique de canal.
- Q: Que faire si la facture n'a pas de client associé, ou un client sans téléphone ? → R : `ConflictException` explicite — contrairement à `PaymentLinkNotificationService.notify()` (best-effort silencieux pendant l'émission, jamais bloquant), `send-reminder` est une action explicitement déclenchée par un humain : elle doit donner un retour clair, pas échouer silencieusement.
- Q: Faut-il empêcher un rappel "trop rapproché" (anti-spam) ? → R : non — aucun champ de throttle demandé, l'action est déclenchée manuellement par un humain qui contrôle déjà la cadence (même absence de garde que `regeneratePaymentLink`, "régénérable à la demande" ADR-066). Ne pas sur-construire.

## Problème (en 3 lignes max)
`InvoiceEventType.payment_reminder_sent` existe dans l'enum depuis le début du repo mais n'est émis par aucun code — un client dont la facture est en retard de paiement n'a aujourd'hui aucun moyen d'être relancé par la PME via facture.gn.

## Solution retenue (en 5 lignes max)
`InvoicesService.sendReminder(invoiceId, actorId)` : vérifie que la facture est `issued`/`partially_paid` ET en retard (`issuedAt` + `OVERDUE_THRESHOLD_DAYS` dépassé), charge le client associé (rejette si absent/sans téléphone), envoie le message via le nouveau `PaymentReminderService.send()` (réutilise `resolveNotificationProviders()`, message mentionnant `amountDue`), émet `InvoiceEvent(type: "payment_reminder_sent", actorId)` dans une transaction (même garantie d'audit que `regeneratePaymentLink`). `POST /invoices/:id/send-reminder` (owner/admin/cashier, idSource par défaut "invoice").

## Alternatives écartées
- Champ `Invoice.dueDate` séparé : écarté — l'ERD n'a jamais eu ce concept, `issuedAt` + seuil fixe suffit à la définition retenue, éviter d'introduire un champ que rien d'autre ne consomme.
- Cron pour l'envoi automatique réel : écarté, même limite déjà acceptée H4/I1.
- Endpoint de lot (`POST /organizations/:id/invoices/send-reminders`) : écarté, non demandé, scope non tranché par le backlog.
- Dupliquer la sélection de canal dans un nouveau service isolé : écarté, violerait la convention "zéro duplication" déjà appliquée à `invoiceLineSchema` (I1).

## Découpage en tâches bite-sized
- [ ] [P] Tâche 1 : `apps/trust-api/src/notifications/notification-dispatch.ts` — extrait `resolveNotificationProviders(channel, smsProvider, whatsappProvider): NotificationProvider[]` (fonction pure) + spec
- [ ] Tâche 2 : refactor `PaymentLinkNotificationService.notify()` pour utiliser `resolveNotificationProviders()` — non-régressif, tests existants revérifiés verts sans modification
- [ ] Tâche 3 : `apps/trust-api/src/invoices/overdue.ts` — `OVERDUE_THRESHOLD_DAYS = 30`, `isOverdue(invoice: {status, issuedAt}): boolean` (pure) + spec
- [ ] Tâche 4 : `apps/trust-api/src/notifications/payment-reminder.service.ts` — `PaymentReminderService.send(customer, invoiceNumber, amountDueGnf)`, même garantie best-effort/ne-lève-jamais que `PaymentLinkNotificationService` + spec ; wiring dans `notifications.module.ts`
- [ ] Tâche 5 : `InvoicesService.sendReminder(invoiceId, actorId)` + spec (garde statut+retard, garde client/téléphone, transaction+événement)
- [ ] Tâche 6 : `POST /invoices/:id/send-reminder` dans `invoices.controller.ts` (`@Roles("owner","admin","cashier")`, mêmes conventions que `regenerate-payment-link`) + spec contrôleur si le fichier en a un, sinon vérifier le wiring manuellement

## Tests à écrire AVANT le code
- [ ] `resolveNotificationProviders` : `"sms"` → [sms], `"whatsapp"` → [whatsapp], `"both"` → [sms, whatsapp]
- [ ] `PaymentLinkNotificationService.notify()` : suite existante inchangée et verte après refactor (non-régression)
- [ ] `isOverdue` : `issued` + `issuedAt` > 30j → true ; `issued` + `issuedAt` = 15j → false ; `paid`/`voided`/`draft` → toujours false quel que soit `issuedAt`
- [ ] `PaymentReminderService.send()` : sélectionne le(s) bon(s) provider(s), ne lève jamais même si le provider échoue (catch + log, même pattern que `PaymentLinkNotificationService`)
- [ ] `sendReminder()` : rejette (`ConflictException`) une facture non en retard ; rejette une facture `draft`/`paid`/`voided` ; rejette une facture sans client associé ; rejette un client sans téléphone ; émet `payment_reminder_sent` avec le bon `actorId` sur succès
- [ ] Contrôleur : route protégée par le même trio que `regenerate-payment-link`

## Critères de done
- Tous les tests verts (nouveaux + non-régression complète `invoices.service.spec.ts`, `payment-link-notification.service.spec.ts`)
- Typecheck/lint clean
- `dev-code-reviewer` OK

## Risques identifiés & mitigations
- Risque 1 : régression sur `PaymentLinkNotificationService` (chemin déjà utilisé en prod à l'émission) → mitigation : refactor à comportement strictement identique, suite de tests existante rejouée sans modification avant d'ajouter le nouveau service.
- Risque 2 : confondre le seuil `OVERDUE_THRESHOLD_DAYS` avec un vrai champ `dueDate` dans une future story → mitigation : nommage explicite + commentaire renvoyant à ce plan.
