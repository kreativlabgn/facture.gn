# Plan : Inviter un collaborateur au cabinet/CGA (F8, ADR-068)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `practices/` existant (F4, mergée), aucun nouveau modèle
- Persona affecté : `practice_admin` d'un cabinet/CGA (Mamadou) qui ajoute un collaborateur (`accountant_external`) déjà inscrit sur facture.gn
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun direct

## Investigation préalable — pourquoi cette story maintenant
Backlog : "F8 — Inviter un collaborateur au cabinet/CGA `[SHOULD]` — Réf : ADR-068." Toutes les stories `[MUST]` restantes du backlog ont été passées en revue et sont bloquées par une infrastructure absente hors scope d'une story unique : C9 (WhatsApp/SMS, intégration externe), C19 (page Checkout + grille commission ADR-074 non implémentée, `platformFeeAmount` codé en dur à 0 partout dans ce repo), D1-D4 (USSD, aucune passerelle), G2 (gel de plafonds après reset PIN, aucun mécanisme de reset PIN construit), H1/H2 (différenciation de formules, nécessite un mécanisme d'abonnement/facturation qui n'existe pas). F8 est la première story `[SHOULD]` immédiatement buildable avec l'infrastructure déjà en place, et elle complète directement la série F (écosystème cabinet) qui vient d'être terminée pour son périmètre MUST.

`ADR-068` (déjà cité pour F4) : *"Entité de premier niveau parallèle à organization... Dashboard propre, facturation propre, **collaborateurs**."* — les collaborateurs font partie de la définition même de `professional_practice`, jamais construits jusqu'ici (F4 n'a créé que le `practice_admin` fondateur).

**Distinction avec F10** ("Inviter un client non encore inscrit `[SHOULD]`") : F10 couvre explicitement le cas d'un utilisateur SANS compte facture.gn — F8 se limite donc à un collaborateur DÉJÀ inscrit (identifié par son numéro de téléphone, `UserPhone`, même mécanisme de résolution que `OrganizationsService.createAssisted()`), cohérent avec la séparation déjà actée par le backlog lui-même entre ces deux stories.

## Problème (en 3 lignes max)
Un `practice_admin` ne peut ajouter aucun collaborateur à son cabinet — `PracticeMember` n'est peuplé que par la création du cabinet (F4, le fondateur devient `practice_admin`), aucun mécanisme n'existe pour y ajouter un second membre.

## Solution retenue (en 5 lignes max)
`POST /practices/:id/members` — aucun `@Roles()` (comme tout le module `mandates/practices`, autorisation en ligne). `PracticesService.inviteMember(practiceId, dto, requesterUserId)` : (1) vérifie que l'appelant est `practice_admin` de la practice ciblée (réutilise `assertPracticeAdmin()`-like, même précédent que F5/F6) ; (2) résout l'utilisateur invité via `UserPhone.findUnique({msisdn})` — 404 explicite si le numéro n'est associé à aucun compte (le cas "non encore inscrit" est F10, hors scope ici) ; (3) refuse (409) si cet utilisateur est déjà membre actif (`leftAt: null`) de cette practice ; (4) crée `PracticeMember(practiceId, userId, role: "accountant_external", joinedAt: now())`. `role` restreint à `accountant_external` côté DTO (ADR-070, `business_manager` reste V1 — même restriction déjà appliquée au `grantedRole` de F5).

## Alternatives écartées
Inviter par un flux d'invitation asynchrone (email/SMS avec lien d'acceptation) — écartée : aucune infrastructure de notification (WhatsApp/SMS, C9) n'existe dans ce repo, et le backlog ne le demande pas explicitement ici (contrairement au mandat, F1/F5, qui a une étape d'acceptation explicite documentée par ADR-069 — aucun équivalent documenté pour l'ajout d'un collaborateur). Ajout immédiat et direct, cohérent avec le fait qu'un `practice_admin` ajoute quelqu'un qu'il connaît déjà (collègue de cabinet), pas un tiers externe. Accepter `role: business_manager` — écartée, V1 (ADR-070), même raisonnement que F5.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/practices/dto/invite-member.dto.ts` (nouveau) — `msisdn: msisdnSchema`, `role: z.enum(["accountant_external"])`
- [ ] Tâche 2 : `apps/trust-api/src/practices/practices.service.ts` — ajoute `inviteMember(practiceId, dto, requesterUserId)`
- [ ] Tâche 3 : `apps/trust-api/src/practices/practices.controller.ts` — ajoute `POST :id/members`

## Tests à écrire AVANT le code
- [ ] Test 1 (`invite-member.dto.spec.ts`) : `role: "business_manager"` rejeté (ADR-070)
- [ ] Test 2 : `msisdn` mal formé rejeté
- [ ] Test 3 (`practices.service.spec.ts`) : un `practice_admin` ajoute un collaborateur déjà inscrit → `PracticeMember` créé avec `role: accountant_external`
- [ ] Test 4 : refuse si l'appelant n'est pas `practice_admin` de la practice ciblée
- [ ] Test 5 : refuse (404) si le `msisdn` n'est associé à aucun compte
- [ ] Test 6 : refuse (409) si l'utilisateur est déjà membre actif de cette practice
- [ ] Test 7 : accepte un ré-ajout si le seul membership existant a `leftAt` renseigné (parti puis réinvité)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune migration Prisma nécessaire
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : doublon `PracticeMember` actif pour le même utilisateur → mitigation : garde applicative dédiée (test 6), même précédent que les gardes anti-doublon déjà établies (F5, Mandate).
