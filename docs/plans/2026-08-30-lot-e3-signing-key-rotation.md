# Plan : Lot E3 — Rotation de la clé racine de signature par organisation (Vague 3)

## Contexte projet
- **Module** : Trust Context — `apps/trust-api/src/certification/` (`organization-signing-key.service.ts`), `apps/trust-api/src/organizations/` (endpoint + délégation), `packages/db` (schéma `OrganizationSigningKey`).
- **Persona affecté** : `owner` / `admin` d'une organisation (déclenche la rotation, comme la révocation A4). Un vérificateur externe : **aucun changement observable** (la vérification suit toujours `Invoice.signingKeyId`).
- **Données sensibles** : clé privée Ed25519 (générée, chiffrée-enveloppe `CERTIFICATION_MASTER_KEY`, jamais en clair au repos). → `dev-security-reviewer` **obligatoire**.
- **Impact réglementaire** : DAT §Crypto — *« Ed25519, SHA-256, rotation 365j »*. ADR-025 (*« révocation jamais rétroactive »*) : une clé retirée (superseded) N'EST PAS révoquée — elle reste valide pour les factures signées pendant qu'elle était active. Distinct d'ADR-026 (clés **déléguées par canal**, non construites — hors périmètre).

## Clarifications
- **Q : E1 (ancrage Merkle) inclus ?** → R : **Non.** Deux lots séparés — E3 (ce lot), E1 ensuite (ADR + `dev-architect`, mécanisme OpenTimestamps/Bitcoin).
- **Q : ADR alors que `V/` est sale ?** → R : ADR rédigé dans `code/docs/architecture/adr-e3-signing-key-rotation.md` (n° provisoire **ADR-114**), porté vers `V/Registre-ADR-facture-gn.md` quand `V/` sera propre.
- **Q (planning) : modèle « clé active » ?** → R : ajouter `retiredAt DateTime?` (null = pas retirée). **Index unique partiel** (SQL brut, précédent `pending_member_invite_one_live_per_org`) : `WHERE retired_at IS NULL AND revoked_at IS NULL` → au plus **une clé active par organisation**. Pas d'enum `status` (dérivable de `retiredAt`/`revokedAt`, moins d'états illégaux).
- **Q (planning) : auto-rotation 365j maintenant ?** → R : **différée en fast-follow.** Ce lot livre la rotation **manuelle** + un indicateur `rotationDue` (âge > 365j) sur `GET .../signing-key`. Une balayeuse BullMQ (pattern J3, opt-in) rotant des clés sans supervision est à haut risque — à traiter séparément avec sa propre revue.
- **Q (planning) : `revoke()` avec plusieurs clés ?** → R : `revoke(organizationId)` révoque la **clé active** (cas courant : « ma clé courante a fuité »). Révoquer une clé *retirée* (forensique) = méthode dédiée, **différée**.

## Problème (3 lignes)
`OrganizationSigningKey` impose `@@unique(organizationId)` → une seule clé racine Ed25519 à vie par organisation. Le DAT exige une rotation à 365j ; aucun mécanisme n'existe. Une clé longue-durée augmente la fenêtre d'exposition (fuite du `CERTIFICATION_MASTER_KEY`, compromission d'un backup) sans possibilité de renouvellement propre — aujourd'hui la seule issue est la **révocation** (qui bloque toute émission jusqu'à… rien, il n'y a pas de remplacement).

## Solution retenue (5 lignes)
Le schéma passe à **N clés par organisation dans le temps**, au plus une active (`retiredAt IS NULL AND revoked_at IS NULL`, garanti par index unique partiel). `rotate(organizationId)` : dans une transaction, retire la clé active (`retiredAt = now()`) et en provisionne une nouvelle (`provisionRootKey`). `certifyForOrganization()` signe avec la clé **active** ; `verifyWithKey(signingKeyId)` est inchangé (lookup par `id`, `Invoice.signingKeyId` fige la clé exacte). `keyValidAtIssuance` inchangé (le retrait n'est pas une révocation). Endpoint `POST /organizations/:id/signing-key/rotate` (owner/admin) + `GET /organizations/:id/signing-key` (métadonnées + `rotationDue`).

## Alternatives écartées
- **Enum `SigningKeyStatus { active, superseded, revoked }`** : trois états explicites mais permet des combinaisons illégales (`superseded` + `revokedAt` null incohérent, etc.). `retiredAt`/`revokedAt` (deux timestamps nullables) sont plus simples et l'index partiel encode l'invariant « une seule active ».
- **Garder `@@unique(organizationId)` + archiver l'ancienne clé ailleurs** (table `retired_signing_key`) : duplique la logique de chiffrement/vérification, casse le FK `Invoice.signingKeyId` pour les vieilles factures.
- **Rotation = nouvelle ligne + `previousKeyId` en chaîne** : `previousKeyId` n'apporte rien (l'ordre est donné par `createdAt`), complexité inutile.
- **Auto-rotation BullMQ dans ce lot** : écartée (risque — une balayeuse buguée rote toutes les clés ; supervision requise). Fast-follow dédié.
- **Certificat de délégation signé par la racine (ADR-026)** : concerne les clés **par canal**, pas la rotation de la racine. Hors périmètre.

## Découpage en tâches

### Groupe 1 — schéma + migration (livrable seul)
- [ ] 1.1 `packages/db/prisma/schema.prisma` — `OrganizationSigningKey` : `organizationId String @map("organization_id")` (retirer `@unique`), ajouter `retiredAt DateTime? @map("retired_at")`, `@@index([organizationId])`. `Organization.signingKey OrganizationSigningKey?` → `signingKeys OrganizationSigningKey[]`.
- [ ] 1.2 `packages/db/prisma/migrations/20260830140000_signing_key_rotation/migration.sql` (manuelle) : `DROP CONSTRAINT "organization_signing_key_organization_id_key"` ; `ADD COLUMN "retired_at" TIMESTAMP(3)` ; `CREATE INDEX "organization_signing_key_organization_id_idx"` ; `CREATE UNIQUE INDEX "organization_signing_key_one_active_per_org" ON "organization_signing_key"("organization_id") WHERE "retired_at" IS NULL AND "revoked_at" IS NULL`. En-tête : les lignes existantes (1/org, `retired_at` NULL) satisfont l'index partiel.
- [ ] 1.3 `pnpm --filter @facture-gn/db db:generate && build`.
- [ ] 1.4 `apps/trust-api/src/scripts/backfill-organization-signing-keys.ts` — `where: { signingKey: null }` → `where: { signingKeys: { none: {} } }`.

### Groupe 2 — service (dépend du Groupe 1)
- [ ] 2.1 `organization-signing-key.service.ts::certifyForOrganization` — `findUniqueOrThrow({ where: { organizationId } })` → `findFirst({ where: { organizationId, retiredAt: null }, orderBy: { createdAt: "desc" } })`. Si `null` → `ConflictException("aucune clé de signature active — rotation requise")`. Si `revokedAt` → `ConflictException` (message A4 existant conservé).
- [ ] 2.2 `provisionRootKey` — inchangé sur le fond ; ajouter un commentaire : crée toujours une clé active (`retiredAt` défaut NULL). Reste appelé à la création d'org (3 sites) et par `rotate`.
- [ ] 2.3 **`rotate(organizationId: string)`** — nouveau. `$transaction` : `current = tx.organizationSigningKey.findFirst({ where: { organizationId, retiredAt: null } })` ; si `current && !current.revokedAt` → `tx.update({ where: { id: current.id }, data: { retiredAt: new Date() } })` ; puis `await this.provisionRootKey(organizationId, tx)`. Catch `P2002` sur `organization_signing_key_one_active_per_org` → `ConflictException("rotation déjà en cours")` (course concurrente). Retourne la nouvelle clé (metadata publique, jamais `encryptedPrivateKey`).
- [ ] 2.4 `revoke(organizationId)` — `findUniqueOrThrow({ where: { organizationId } })` → `findFirst({ where: { organizationId, retiredAt: null } })`. Si `null` → `NotFoundException("aucune clé active à révoquer")`. Idempotence sur `revokedAt` conservée. `update` ciblé par `id` (plus par `organizationId`).
- [ ] 2.5 **`getKeyStatus(organizationId)`** — nouveau. Retourne `{ publicKey, createdAt, ageInDays, rotationDue: ageInDays > ROTATION_INTERVAL_DAYS, revokedAt, retiredKeyCount }` pour la clé active (ou `{ active: false }` si aucune). `ROTATION_INTERVAL_DAYS = 365` (constante, en-tête : DAT §Crypto).
- [ ] 2.6 `verifyWithKey` — **inchangé** (lookup par `id`). Ajouter un test de non-régression : une facture signée par une clé désormais retirée reste `integrityValid` + `keyValidAtIssuance` true.

### Groupe 3 — endpoint + délégation (dépend du Groupe 2)
- [ ] 3.1 `organizations.service.ts` — `rotateSigningKey(organizationId)` (délégation, comme `revokeSigningKey`), `getSigningKeyStatus(organizationId)`.
- [ ] 3.2 `organizations.controller.ts` — `POST :id/signing-key/rotate` (`@Roles("owner","admin")`, `@OrganizationIdSource("organization")`, à côté de `revoke`) ; `GET :id/signing-key` (mêmes rôles + `auditor` ? → **non**, garder owner/admin : la clé publique n'est pas secrète mais le statut de rotation est opérationnel). DTO de réponse (jamais `encryptedPrivateKey`).
- [ ] 3.3 `openapi` : pas de fichier openapi dans `code/` — rien à faire (l'openapi vit dans `V/`, hors périmètre).

### Groupe 4 — clôture
- [ ] 4.1 `docs/architecture/adr-e3-signing-key-rotation.md` — ADR-114 provisoire : N clés/org dans le temps, une active (index partiel), retrait ≠ révocation, `keyValidAtIssuance` inchangé, 365j = cible (indicateur `rotationDue`, auto-rotation différée), lien avec ADR-025/026.
- [ ] 4.2 `docs/runbooks/` — note courte : rotation manuelle via l'endpoint ; auto-rotation 365j = fast-follow ; que faire si `certifyForOrganization` lève « aucune clé active » (ex. après une révocation → roter).
- [ ] 4.3 revalidation complète : `tsc` + `eslint` + `vitest --coverage` (trust-api), `vitest` (money-api, db), `audit-ci`.

## Tests à écrire AVANT le code

### Groupe 1
- [ ] Aucun test unitaire de schéma ; l'index partiel est validé par la CI (`db:migrate:deploy` sur `postgres:16`) + le test de course de `rotate` (Groupe 2).

### Groupe 2 — `organization-signing-key.service.spec.ts`
- [ ] `rotate()` : retire la clé active (`retiredAt` posé), en crée une nouvelle active, la nouvelle a un `publicKey` différent.
- [ ] `rotate()` quand la clé active est révoquée : ne pose pas `retiredAt` sur la révoquée, provisionne quand même une nouvelle active.
- [ ] `rotate()` deux fois : la 1ʳᵉ clé est retirée, la 2ᵉ est retirée, seule la 3ᵉ est active.
- [ ] Course : deux `rotate()` concurrents → `P2002` sur l'index partiel → l'un lève `ConflictException`, l'état final n'a **qu'une** clé active (test avec un faux Prisma stateful, pattern `client-portal-otp.service.spec` / `invoice-numbering`).
- [ ] `certifyForOrganization()` : signe avec la clé **active** (pas une retirée). Après `rotate()`, signe avec la nouvelle.
- [ ] `certifyForOrganization()` sans clé active (toutes retirées/révoquées) → `ConflictException`.
- [ ] `revoke()` : révoque la clé active, idempotent, `NotFoundException` si aucune active.
- [ ] `verifyWithKey()` : une facture dont `signingKeyId` pointe une clé **retirée** reste vérifiable (`integrityValid` true, `revokedAt` null).
- [ ] `getKeyStatus()` : `rotationDue` false à J+0, true à J+366 (injecter `createdAt`), `retiredKeyCount` correct.

### Groupe 3
- [ ] `organizations.service.spec.ts` : `rotateSigningKey` / `getSigningKeyStatus` délèguent.
- [ ] `organizations.controller.spec.ts` (si existant) : `POST :id/signing-key/rotate` owner/admin, 403 pour les autres rôles ; réponse ne contient jamais `encryptedPrivateKey`.

### Non-régression
- [ ] `verification.service.spec.ts`, `invoices.service.spec.ts` (issue → certification) : verts sans changement de comportement.

## Critères de done
- Aucun `[NEEDS CLARIFICATION]`.
- **Aucune facture existante re-vérifiée différemment** — `Invoice.signingKeyId` fige la clé, `verifyWithKey` par `id` inchangé (test de garde).
- Invariant « au plus une clé active par org » garanti en base (index unique partiel), pas seulement en applicatif.
- `encryptedPrivateKey` **jamais** dans une réponse HTTP ni un log (test + revue).
- `CERTIFICATION_MASTER_KEY` non exposé, clé privée jamais en clair au repos.
- Tests verts, couverture ≥ seuils, `tsc` + `eslint` + `audit-ci` clean.
- `dev-code-reviewer` + `dev-security-reviewer` + `dev-domain-model-reviewer` (nouveau modèle `retiredAt` sur un type sensible) OK.

## Risques & mitigations
- **R1 — migration : `DROP CONSTRAINT` sur une contrainte dont le nom généré diffère.** → Vérifier le nom exact (`organization_signing_key_organization_id_key`, convention Prisma) dans la migration `init` ; `DROP CONSTRAINT IF EXISTS` + recréer l'index simple.
- **R2 — une org se retrouve sans clé active** (révocation sans rotation ensuite → `issue()` bloqué). → Comportement **voulu** (identique à aujourd'hui : révocation bloque l'émission) ; message d'erreur explicite pointant `rotate` ; documenté au runbook.
- **R3 — course sur `rotate()`** → index unique partiel + catch `P2002` → `ConflictException` ; test de course dédié.
- **R4 — `certifyForOrganization` dans la transaction `issue()` : `findFirst` non-`OrThrow`** → gérer `null` explicitement (ConflictException) sinon `undefined.encryptedPrivateKey` planterait la transaction avec une erreur opaque.
- **R5 — `keyValidAtIssuance` régresse si on confond retrait et révocation** → `keyValidAtIssuance` ne lit QUE `revokedAt`, jamais `retiredAt` (test de garde explicite).
- **R6 — l'ADR-114 provisoire diverge de la version portée dans `V/`** → contenu figé dans `code/docs/`, port mécanique quand `V/` est propre ; note « provisoire » dans l'en-tête.

## Séquence
1. Groupe 1 (schéma) — livrable seul.
2. Groupe 2 (service) — dépend du 1.
3. Groupe 3 (endpoint) — dépend du 2.
4. Groupe 4 — ADR + runbook + clôture.
Puis : **E1 (ancrage Merkle, OpenTimestamps)** dans un lot séparé (PLAN + `dev-architect`).

---

## ✅ LIVRÉ (avant revue)
- **G1** : `schema.prisma` (`retiredAt`, `@@index`, `signingKeys[]`), migration `20260830140000_signing_key_rotation` (`DROP INDEX` unique + `ADD COLUMN` + index simple + **index unique partiel** `one_active_per_org`), backfill script (`signingKeys: { none: {} }`).
- **G2** : `organization-signing-key.service.ts` — `certifyForOrganization`/`revoke` sur `findFirst({ retiredAt: null })` ; nouveaux `rotate()` (transaction, retrait atomique + provision, catch P2002 → 409) et `getKeyStatus()` (`rotationDue` = âge > 365 j, `retiredKeyCount`). `verifyWithKey` inchangé. `keyValidAtIssuance` ne lit que `revokedAt`.
- **G3** : `POST /organizations/:id/signing-key/rotate` + `GET /organizations/:id/signing-key` (owner/admin, `@OrganizationIdSource("organization")`), délégation `organizations.service`.
- **G4** : `docs/architecture/adr-e3-signing-key-rotation.md` (ADR-114 provisoire), `docs/runbooks/signing-key-rotation.md`.
- **Tests** : `organization-signing-key.service.spec`, `organizations.{controller,service}.spec`.

### Revues (3 sous-agents) → CHANGES → correctifs appliqués
Code **CHANGES** (1 bug conf. 88), sécurité **CHANGES** (F1, F2), domaine **CHANGES** ([6/10]) — **tous convergent sur le même défaut**. Correctifs :
- **Prédicat « clé courante » déterministe** — `rotate()` retire la clé sortante **inconditionnellement** (`if (current)`), garantissant ≤ 1 ligne `retiredAt: null` par org. `revoke()` / `getKeyStatus()` gagnent `orderBy: { createdAt: "desc" }` (filet). Fini l'état à 2 lignes après « révoquer puis roter » où `revoke()` pouvait no-op en silence sur une clé compromise.
- **F1** — `revoke()` retourne `publicView(key)` (métadonnées publiques) sur les deux chemins — **plus jamais `encryptedPrivateKey` dans la réponse HTTP**.
- `getKeyStatus()` : clé courante révoquée → `{ active: false, revokedAt }` (l'UI incite à roter).
- `rotationDue` : `>= 365` (au lieu de `> 365`).
- **F4** — `@Throttle({ limit: 3, ttl: 60_000 })` sur `POST /signing-key/rotate`.
- Commentaire périmé `organizations.service.ts` (`@unique` → index partiel).
- Tests ajoutés : `retire inconditionnellement même une clé révoquée` ; `revoke → rotate → revoke` (la 2e révocation cible la nouvelle clé) ; `getKeyStatus` clé courante révoquée.
- **Runbook + ADR-114** : consigne impérative « RÉVOQUER D'ABORD, roter ensuite ».

### Re-revues (sécurité + domaine) → APPROUVÉ / COHÉRENT
F1 + F2 confirmés résolus, zéro régression. Derniers points LOW appliqués :
- `SigningKeyStatus` : champ discriminant `state: "none" | "active" | "revoked"`, tous les champs non-optionnels (contrat HTTP cohérent, plus de `revokedAt` `undefined` vs `null`).
- `getKeyStatus()` branche révoquée : `rotationDue: true` quel que soit l'âge (R2 — l'UI pilote son CTA dessus).
- `@Throttle` aussi sur `POST /signing-key/revoke`.
- ADR-114 : wording « garanti par l'index partiel **+** discipline des call sites », note de re-vérification pour F5 / auto-rotation.

### Fast-follow (**engagés avant GA / agrément PDP** — la re-revue sécu insiste : ne doivent pas glisser)
- **F3** — journal d'audit append-only des `rotate` / `revoke` de la clé racine (acteur, org, keyId, ts) + alerting.
- **F5** — `revokeKey(orgId, keyId)` : révoquer une clé **retirée** (ferme le footgun « roter avant révoquer » ; `revoke()` renvoyant 200 sur la mauvaise clé après un rotate-first est un piège silencieux pour l'opérateur).
- Auto-rotation 365 j (pattern BullMQ opt-in, revue sécu dédiée). En construisant F5 ou l'auto-rotation : **ne jamais insérer une clé sans retirer la sortante** (invariant applicatif, cf. ADR-114).

Suite trust-api **1263 passed / 3 skipped**, couv. > seuils. money-api 112, db, audit-ci OK. tsc + eslint clean.
