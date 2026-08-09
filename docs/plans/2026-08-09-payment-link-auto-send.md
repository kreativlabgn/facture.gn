# Plan : Configurer l'envoi du lien de paiement (immédiat ou différé) (C20)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension d'une méthode déjà testée (`issue()`), aucun nouveau module
- Persona affecté : organisation (Parcours Aminata, freelance/devis) qui veut émettre une facture sans déclencher tout de suite la génération/l'envoi du lien de paiement
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun

## Investigation préalable
Backlog : "C20 — Configurer l'envoi du lien (immédiat ou différé) `[SHOULD]`" — Réf : Parcours Aminata, aucun bullet. ERD-facture-gn.md §Organization confirme explicitement : `payment_link_auto_send | boolean | Défaut true (C20)` — le marqueur exact pointant vers cette story.

**Découverte structurante** : `Organization.paymentLinkAutoSend` (schema.prisma:254, `@default(true)`) existe depuis le début du schema mais n'est lu NULLE PART dans le code (grep confirmé sur `apps/`) — `issue()` (`invoices.service.ts:187`) appelle `paymentLinkClient.tryGenerate()` INCONDITIONNELLEMENT, sans jamais consulter ce champ. Même pattern déjà rencontré cette session (`AssistedSession` → F2, `Mandate` → F7/F9, `platformFeeAmount: 0n` → grille de commission).

**Décision de scope sur "envoi"** : aucune infrastructure WhatsApp/SMS n'existe dans ce repo (C9, `[MUST]`, ADR-060, explicitement bloquée — pas de provider de messagerie scaffoldé). "Envoi du lien" est donc interprété comme la GÉNÉRATION du lien à l'émission (le seul comportement qui existe réellement aujourd'hui, C2 Phase 2a), pas un envoi push vers le client. `paymentLinkAutoSend=true` (défaut) : comportement actuel inchangé, le lien est généré immédiatement à `issue()`. `paymentLinkAutoSend=false` : `issue()` n'appelle PAS `tryGenerate()`, le lien reste `null` jusqu'à un appel explicite ultérieur à `POST :id/regenerate-payment-link` (C18, déjà mergée) — réutilise 100% une infrastructure existante, aucun nouveau mécanisme de "envoi différé programmé" n'est construit (hors scope, aucun scaffolding pour une tâche planifiée).

**Décision de scope sur la lecture du champ** : test strict `organization.paymentLinkAutoSend === false` (pas un simple falsy-check) — protège les ~40 tests existants de `issue()` dans `invoices.service.spec.ts` qui mockent `organization.findUniqueOrThrow()` SANS ce champ (`undefined`) : avec un strict `=== false`, `undefined` se comporte comme `true` (comportement actuel préservé), aucune fixture partagée à modifier. Cohérent avec la discipline "minimiser le rayon d'impact sur les tests déjà verts" déjà appliquée pour la grille de commission.

## Problème (en 3 lignes max)
`issue()` génère toujours le lien de paiement immédiatement, sans jamais consulter `Organization.paymentLinkAutoSend` — une organisation qui préfère différer la génération (ex. facture émise avant qu'un mode de paiement soit convenu avec le client) n'a aucun moyen de le faire.

## Solution retenue (en 5 lignes max)
Dans `issue()`, entourer l'appel à `paymentLinkClient.tryGenerate()` d'une condition `organization.paymentLinkAutoSend !== false` — si `false`, l'émission committe normalement (certification, numéro, statut `issued`) mais le lien reste `null`. Aucun nouveau champ, aucune nouvelle route : `POST :id/regenerate-payment-link` (C18) existe déjà pour générer le lien plus tard à la demande.

## Alternatives écartées
Construire un mécanisme d'envoi différé programmé (ex. job planifié générant le lien X heures après émission) — écartée, aucun scaffolding pour une tâche planifiée dans ce repo, et le backlog ne le demande pas explicitement ("différé" est satisfait par "à la demande via C18", pas par un envoi automatique retardé).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/invoices/invoices.service.ts:issue()` — condition `organization.paymentLinkAutoSend !== false` autour du bloc `tryGenerate()`

## Tests à écrire AVANT le code
- [ ] Test 1 (`invoices.service.spec.ts`) : `paymentLinkAutoSend: false` → `issue()` committe normalement, `paymentLinkClient.tryGenerate` JAMAIS appelé, `paymentLinkUrl` reste `null`
- [ ] Test 2 : `paymentLinkAutoSend: true` (explicite) → comportement inchangé, lien généré (non-régression du comportement existant, formulée explicitement pour ce champ)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante, ZÉRO fixture partagée modifiée)
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : casser silencieusement les ~40 tests existants de `issue()` si le check n'est pas strictement `=== false` → mitigation : `!== false` (pas un falsy-check), vérifié par l'exécution complète de la suite avant commit.
