# Plan : Option 4 USSD — Émettre une facture (D1)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`) — réutilise `InvoicesService` (createDraft+issue, déjà signature serveur immédiate + notification SMS/WhatsApp C9 déjà câblée), `OrganizationsService.listMine()`.
- Persona affecté : agent terrain/PME feature phone émettant sans smartphone.
- Données sensibles : montant, numéro client — pas de nouvelle catégorie.

## Investigation préalable

§2.4 Spec USSD : « Séquence complète < 90 secondes. Signature serveur immédiate. Idempotence stricte. Lien de paiement généré et envoyé par SMS au client (si numéro renseigné)... Plafonds velocity_tier vérifiés avant confirmation. »

**Vérification volontairement DIFFÉRÉE** : `velocity_tier` n'existe pas encore (tâche suivante `ussd-velocity-tier`, D4) — cette tâche construit l'émission SANS ce garde-fou, la tâche suivante l'insère dans le même flux sans réécrire le reste.

**Réutilisation maximale, aucune nouvelle logique métier de facturation** : `InvoicesService.createDraft()`+`issue()` gèrent déjà signature serveur immédiate (A3), et — découverte en relisant `invoices.service.ts` — la notification SMS/WhatsApp (C9, déjà mergée) se déclenche automatiquement dès qu'une facture avec `customerId` est émise et que ce client a un téléphone. Il suffit donc de rattacher un `Customer` (existant ou créé à la volée) portant le numéro saisi — aucun nouveau code d'envoi SMS à écrire pour cette tâche.

**Organisation cible** : le contexte d'authentification ne porte `organizationId` que pour le chemin "code compte" (§3.2 — le compte identifie directement une organisation). Pour un "téléphone reconnu" (§3.1), l'utilisateur peut appartenir à plusieurs organisations — résolu via `OrganizationsService.listMine(userId)`, premier membership avec un rôle habilité à émettre (`owner`/`admin`/`accountant_internal`/`cashier`/`field_agent`, même trio que `POST /invoices` — l'appel bypasse `RolesGuard` HTTP puisqu'il vient directement du service, ce contrôle de rôle est donc reconstruit explicitement ici, pas une confiance implicite).

**Description de ligne** : le canal ne collecte qu'un montant, jamais une description (§2.4, "montant, client" uniquement) — `CreateInvoiceDto` exige `lines[].description` non vide (contrainte du modèle). Une constante `"Vente USSD"` est utilisée, jamais un champ inventé côté utilisateur.

**Idempotence transport** : `InvoicesService.issue()` porte déjà l'immutabilité post-émission et la numérotation atomique (garde-fous existants), mais aucune clé d'idempotence dédiée à la REQUÊTE USSD elle-même n'est construite ici (ex. un retry réseau de l'agrégateur au moment exact de la confirmation pourrait, en théorie, créer deux factures distinctes). **Limite acceptée et documentée**, pas un gap caché — la fenêtre de risque est étroite (une seule transition d'état, session à usage unique) et aucune autre story de ce repo n'a construit d'idempotency-key au niveau transport USSD à ce jour ; à traiter si l'usage réel révèle des doublons.

## Décision d'architecture

**`UssdInvoiceService`** (`ussd/ussd-invoice.service.ts`) :
- `resolveOrganizationForEmission(userId, organizationIdHint?)` → `organizationIdHint` si fourni (déjà validé par le chemin code compte) ; sinon `listMine(userId)`, premier membership avec un rôle habilité, `null` sinon.
- `resolveOrCreateCustomer(organizationId, phone?)` → `undefined` si `phone` absent ; sinon `Customer.findFirst({organizationId, phone})`, créé à la volée (`name: phone`, faute de nom collecté par ce canal) si absent.
- `emitInvoice(organizationId, amountGnf, customerId?)` → `InvoicesService.createDraft()` (une ligne, `"Vente USSD"`, quantité 1, `unitPrice: amountGnf`) puis `.issue()` — le lien de paiement et la notification SMS/WhatsApp suivent automatiquement (C2/C9, déjà câblés).

**Nouveaux états `UssdSessionService`** : `emit_awaiting_amount` (déclenché depuis `completeAuthentication` si `pendingOption === "4"`, remplace le stub générique pour ce choix précis) → `emit_awaiting_customer_phone` → émission puis fin de session, message de confirmation (numéro de facture + rappel "lien envoyé par SMS" si un téléphone a été saisi).

## Alternatives écartées

**Collecter une description de ligne à l'utilisateur** — écartée, hors du texte spec (§2.4 : "montant, client" seulement), rallongerait une séquence dont la contrainte explicite est < 90s.

**Construire l'idempotency-key transport dès cette tâche** — écartée pour cette passe (voir investigation ci-dessus), documentée comme limite acceptée plutôt que bloquante.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `ussd-invoice.service.spec.ts` — résolution organisation (hint direct, via membership, rôle non habilité → null) ; résolution/création client (absent, existant, création) ; émission (ligne unique, montant correct)
- [ ] Tâche 2 (GREEN) : `UssdInvoiceService`
- [ ] Tâche 3 (RED) : `ussd-session.service.spec.ts` — flux complet option 4 : montant → téléphone → confirmation ; montant invalide reprompt ; téléphone invalide reprompt ; aucune organisation éligible → message d'échec
- [ ] Tâche 4 (GREEN) : câblage dans `UssdSessionService`

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Une facture émise via ce chemin est strictement identique (signature, chaînage, numérotation) à une facture émise via l'API REST — aucune logique de certification dupliquée ou court-circuitée

## Risques identifiés & mitigations
- Risque 1 (détaillé ci-dessus) : idempotence transport non couverte → mitigation : documentée, fenêtre de risque étroite, revisitée si l'usage réel le justifie.
- Risque 2 : un utilisateur reconnu par téléphone mais sans membership habilité pourrait tenter d'émettre → mitigation : `resolveOrganizationForEmission` retourne `null`, le flux répond un message d'échec explicite, jamais une facture émise sans organisation résolue.
