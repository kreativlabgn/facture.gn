# Plan : Registre émetteur — vérification à la date d'émission (A4, SHOULD, ADR-025)

## Contexte projet
- Module : Trust Context — `apps/trust-api/src/certification/` (révocation), `apps/trust-api/src/verification/` (exposition publique), `apps/trust-api/src/invoices/invoices.service.ts` (garde additive à l'émission)
- Persona affecté : vérificateur externe (quiconque, `verify.facture.gn`) ; owner/admin de l'organisation (déclenche la révocation)
- Données sensibles manipulées : clé cryptographique Ed25519 (déjà chiffrée en enveloppe, `envelope-encryption.ts`) — la révocation pose uniquement un flag, ne touche jamais `encryptedPrivateKey`
- Impact réglementaire : aucun direct, renforce la posture de tiers de confiance (PRD §1.2)

## Clarifications
- Q: Une clé révoquée peut-elle être remplacée (rotation) ? → R (défaut) : non — `schema.prisma` documente déjà "le schéma reste rotation-safe... mais aucun mécanisme de rotation actif n'est construit ici" (commentaire A3/ADR-026 existant). Après révocation, l'organisation ne peut plus émettre de facture tant qu'une story future ne construit pas la rotation — limite documentée, pas ignorée.
- Q: La révocation bloque-t-elle la vérification des factures DÉJÀ émises avec cette clé ? → R : non, ADR-025 l'interdit explicitement ("révocation jamais rétroactive") — `verifyWithKey()` (intégrité) reste inchangée, seul un nouveau champ `keyValidAtIssuance` informe sans jamais invalider `integrityValid`.
- Q: Qui peut déclencher une révocation ? → R (défaut) : owner/admin de l'organisation elle-même, self-service — même trio que les autres actions de structuration sensibles (`upgradeCommercialTier`, H2). Pas de workflow d'approbation (une révocation de clé n'est jamais réversible ni négociable, contrairement à une hausse de limite de crédit).
- Q: Que retourne `keyValidAtIssuance` pour une facture signée par la clé globale légataire (`signingKeyId === null`, A3) ? → R : toujours `true` — ce mécanisme n'a pas de registre de révocation dans ce repo, hors scope A4.

## Problème (en 3 lignes max)
ADR-025 acte qu'une vérification publique doit distinguer "la clé était valide à la date d'émission" de "la clé est valide maintenant" — mais aucun mécanisme de révocation n'existe sur `OrganizationSigningKey`, rendant cette distinction actuellement sans objet (une clé ne peut jamais devenir invalide).

## Solution retenue (en 5 lignes max)
`OrganizationSigningKey.revokedAt` (nullable). `POST /organizations/:id/signing-key/revoke` (owner/admin) pose ce flag. `OrganizationSigningKeyService.certifyForOrganization()` refuse (ConflictException) de signer si la clé de l'organisation est révoquée — garde additive avant la ligne de signature existante, jamais une restructuration. `VerificationService.verifyByCertificationId()` calcule `keyValidAtIssuance = revokedAt === null || issuedAt < revokedAt` (toujours `true` si `signingKeyId` est null, clé légataire) et l'ajoute à la réponse publique, sans jamais toucher à `integrityValid`.

## Alternatives écartées
- **Rotation automatique de clé à la révocation** — écartée, aucune infrastructure de rotation construite nulle part dans ce repo (limite déjà actée), disproportionné pour une story SHOULD.
- **Workflow d'approbation pour la révocation** — écartée, une clé compromise doit pouvoir être révoquée immédiatement par son propriétaire, jamais mise en attente (contrairement à `CreditLimitChangeRequest`, où le risque est financier et réversible).
- **Bloquer la vérification d'intégrité des anciennes factures si la clé est révoquée** — écartée explicitement, contredit ADR-025 ("révocation jamais rétroactive").

## Découpage en tâches bite-sized
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — `OrganizationSigningKey.revokedAt DateTime?` + migration hand-written
- [ ] Tâche 2 : `OrganizationSigningKeyService.revoke(organizationId)` + spec
- [ ] Tâche 3 : `OrganizationSigningKeyService.certifyForOrganization()` — garde additive (refuse si `revokedAt !== null`) + spec, non-régression complète sur `invoices.service.spec.ts` (chemin critique `issue()`)
- [ ] Tâche 4 : endpoint `POST /organizations/:id/signing-key/revoke` (owner/admin, idSource "organization") + spec contrôleur
- [ ] Tâche 5 : `VerificationService.verifyByCertificationId()` — ajoute `keyValidAtIssuance` à `PublicInvoiceVerification` + spec (revokedAt null, revoked avant émission, revoked après émission, clé légataire)

## Tests à écrire AVANT le code
- [ ] `revoke()` pose `revokedAt = now()`, idempotent si déjà révoquée (pas d'erreur sur un second appel — même horodatage, jamais réécrit)
- [ ] `certifyForOrganization()` lève `ConflictException` si la clé est révoquée, message actionnable
- [ ] `certifyForOrganization()` signe normalement si `revokedAt === null` (non-régression du chemin `issue()`)
- [ ] `verifyByCertificationId()` : `keyValidAtIssuance = true` quand jamais révoquée
- [ ] `verifyByCertificationId()` : `keyValidAtIssuance = true` quand révoquée APRÈS `issuedAt` (validité au moment de l'émission préservée)
- [ ] `verifyByCertificationId()` : `keyValidAtIssuance = false` quand révoquée AVANT `issuedAt` (cas théorique — la garde à l'émission l'empêche déjà en pratique, mais le champ doit rester correct par construction)
- [ ] `verifyByCertificationId()` : `keyValidAtIssuance = true` inconditionnellement quand `signingKeyId === null` (clé légataire)
- [ ] `integrityValid` reste inchangé par la révocation (non-régression stricte)

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- Tous les tests verts (nouveaux + non-régression complète `invoices.service.spec.ts`, `verification.service.spec.ts`)
- code-reviewer OK
- security-reviewer OK (obligatoire — touche la crypto de certification)

## Risques identifiés & mitigations
- Risque 1 : régression sur `issue()` (chemin critique déjà certifié, 65+ tests) → mitigation : garde additive en tête de `certifyForOrganization()`, jamais une modification de la logique de signature elle-même ; suite complète rejouée avant merge.
- Risque 2 : confusion entre `integrityValid` (recalcul cryptographique) et `keyValidAtIssuance` (statut du registre) → mitigation : deux champs distincts dans la réponse publique, jamais fusionnés, commentaires explicites sur la différence.
