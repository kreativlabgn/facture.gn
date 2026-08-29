# Plan : Lot D — Canal d'émission sur la facture (`Invoice.emissionChannel`)

## Contexte projet
- Module : **Trust Context** (`apps/trust-api`) + `packages/db` (**migration additive**, aucune donnée détruite).
- Persona : aucun nouveau. Bénéficiaires : PME (filtre "mes factures *620#"), et plus tard analytics / conformité (répartition des canaux d'émission).
- Données sensibles : aucune nouvelle. `emissionChannel` est une métadonnée de traçabilité, jamais un secret, jamais dans le payload certifié.
- Impact réglementaire : positif — traçabilité du canal d'origine d'une facture (utile pour l'audit PDP et la détection LBC/FT par canal).

## Clarifications
- Q : `emissionChannel` fourni par le client dans le DTO ? → R : **non, jamais** — un client PWA pourrait se déclarer `ussd`. Fixé **côté serveur** par le chemin de code (2ᵉ argument de `createDraft`, comme `createAssisted(dto, userId)`).
- Q : valeurs de l'enum ? → R : `pwa`, `ussd`, `agent_terrain`, `api`. `api` **modélisé mais jamais posé** (l'auth par clé API n'est pas câblée, F15) — même précédent que `payment_link`/`bank_transfer` avant leur wiring.
- Q : backfill des factures existantes ? → R : `DEFAULT 'pwa'` — on ne peut pas reconstruire a posteriori qu'une facture est venue de *620# ou d'un agent. `pwa` = canal primaire, choix honnête "inconnu → principal". Documenté dans la migration.
- Q : génération de facture récurrente (I1) — quel canal ? → R : `pwa` (défaut) — déclenchée manuellement via `POST /recurring-templates/:id/generate` (endpoint PWA/JWT). Pas de valeur dédiée.
- Q : endpoint d'agrégat / stats par canal ? → R : **hors Lot D** — c'est une story analytics. Lot D livre le champ + un **filtre** `?emissionChannel=` sur `GET /invoices` (petit, immédiatement utile).

## Problème (3 lignes max)
Aucun champ sur `Invoice` n'indique par quel canal elle a été émise. `createAssisted()` (agent terrain) et l'émission USSD passent par le même `createDraft()`/`issue()` que la PWA et sont indiscernables a posteriori. Impossible de filtrer "mes ventes *620#", de mesurer l'adoption d'un canal, ou de segmenter une analyse LBC/FT par canal.

## Solution retenue (5 lignes max)
Nouvel enum `EmissionChannel` (`pwa`/`ussd`/`agent_terrain`/`api`) + colonne `Invoice.emissionChannel @default(pwa)` (migration additive). `InvoicesService.createDraft(dto, channel: EmissionChannel = "pwa")` — 2ᵉ argument serveur, jamais dans le DTO. `createAssisted()` passe `"agent_terrain"`, `UssdInvoiceService.emitInvoice()` passe `"ussd"`, tous les autres appelants gardent le défaut. `GET /invoices` accepte un filtre optionnel `?emissionChannel=`. Le champ est déjà exposé en lecture (findOne/findAll renvoient l'invoice complète).

## Alternatives écartées
1. **Champ sur `createInvoiceSchema` (DTO client)** — écarté : non fiable (un client ment sur son canal), et incohérent avec le pattern du repo (`createAssisted` prend `userId` en argument séparé, jamais dans le body).
2. **Déduire le canal d'un en-tête (`User-Agent`, en-tête custom PWA)** — écarté : fragile, faux positifs, un intégrateur peut forger l'en-tête. Le chemin de code est la seule source fiable.
3. **Valeur `recurring` dédiée pour I1** — écarté : la génération récurrente est une action humaine via un endpoint PWA ; `pwa` est correct. Ajouter `recurring` mélangerait "canal d'interface" et "mécanisme de déclenchement".
4. **Backfill à `NULL` (canal inconnu explicite)** — écarté : colonne nullable = chaque lecture doit gérer le `null`, et le renderer/filtre aussi. `DEFAULT 'pwa'` sur une poignée de factures de test/dev est sans conséquence pratique et garde le champ non-nullable (invariant plus simple).

## Découpage en tâches bite-sized

### Groupe 1 — Schéma (bloquant pour le reste)
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — `enum EmissionChannel { pwa ussd agent_terrain api }` + `Invoice.emissionChannel EmissionChannel @default(pwa) @map("emission_channel")` (à placer près de `documentType`/`status`).
- [ ] Tâche 2 : `packages/db/prisma/migrations/20260829120000_add_invoice_emission_channel/migration.sql` — `CREATE TYPE` + `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 'pwa'`, commentaire sur le choix du backfill.
- [ ] Tâche 3 : `pnpm --filter @facture-gn/db db:generate` **puis** `pnpm --filter @facture-gn/db build` (ordre impératif).

### Groupe 2 — Service (câblage serveur)
- [ ] Tâche 4 : `invoices.service.ts` — `createDraft(dto: CreateInvoiceDto, channel: EmissionChannel = "pwa")` : persiste `emissionChannel: channel`. Les 65+ tests existants (`createDraft(dto)`) restent verts par le défaut.
- [ ] Tâche 5 : `invoices.service.ts` — `createAssisted()` appelle `this.createDraft(dto, "agent_terrain")`.
- [ ] Tâche 6 : `ussd/ussd-invoice.service.ts` — `emitInvoice()` appelle `createDraft({...}, "ussd")`.
- [ ] Tâche 7 : `invoices.service.ts` — `findAllByOrganization(organizationId, { take, skip, emissionChannel? })` : ajoute `emissionChannel` à la clause `where` si fourni.

### Groupe 3 — Exposition HTTP (filtre)
- [ ] Tâche 8 : `invoices/dto/list-invoices-query.dto.ts` — `invoiceListQuerySchema = organizationScopedListQuerySchema.extend({ emissionChannel: z.enum(["pwa","ussd","agent_terrain","api"]).optional() })`.
- [ ] Tâche 9 : `invoices.controller.ts` — `findAll()` utilise le nouveau schéma, passe `query.emissionChannel` au service.

## Tests à écrire AVANT le code
- [ ] `invoices.service.spec.ts` : `createDraft(dto)` sans 2ᵉ argument → `emissionChannel: "pwa"` persisté (non-régression + défaut).
- [ ] `invoices.service.spec.ts` : `createDraft(dto, "ussd")` → `emissionChannel: "ussd"` persisté.
- [ ] `invoices.service.spec.ts` : `createAssisted(dto, agentId)` (agent avec `AssistedSession` valide) → la facture émise porte `emissionChannel: "agent_terrain"`.
- [ ] `invoices.service.spec.ts` : `findAllByOrganization` avec `emissionChannel: "ussd"` → `where` Prisma contient `emissionChannel: "ussd"` ; sans le filtre → pas de clé `emissionChannel` dans le `where`.
- [ ] `ussd-invoice.service.spec.ts` : `emitInvoice()` délègue à `createDraft` avec `"ussd"` en 2ᵉ argument.
- [ ] `invoices.controller.spec.ts` : `findAll()` transmet `emissionChannel` de la query au service.
- [ ] `list-invoices-query.dto` (ou inline) : `emissionChannel` invalide (`"foo"`) → rejet Zod ; absent → `undefined` ; `organizationId` toujours exigé.

## Critères de done
- Aucun `[NEEDS CLARIFICATION]` restant
- `pnpm --filter @facture-gn/db db:generate && build` faits (sinon typecheck trust-api casse)
- `pnpm turbo lint typecheck test` vert (hors `invoice-numbering.service.integration.spec.ts`)
- `app.module.spec.ts` (smoke DI) toujours vert
- Migration relue au format des migrations existantes (SQL à la main, jamais `prisma migrate dev`)
- `emissionChannel` **jamais** accepté depuis `createInvoiceSchema` (vérifié par l'absence du champ + un test qui confirme le défaut serveur)
- `emissionChannel` **jamais** ajouté à `CertifiablePayload` (grep `organization-signing-key.service.ts` — le payload signé ne porte que invoiceId/nif/number/totalTtc/issuedAt/previousHash)
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` OK (nouvel enum de domaine — vérifier que `agent_terrain` est bien aligné sur `RegistrationSource.agent_terrain`/`isCommercialAgent`, ADR-107, et que l'état "canal non fourni" est irreprésentable)

## Risques identifiés & mitigations
- **R1 — un `createDraft()` oublié garde le défaut `pwa` alors qu'il devrait être autre chose** : mitigation : grep exhaustif des appelants fait dans ce plan (4 sites : controller.create=pwa, createAssisted=agent_terrain, ussd=ussd, recurring=pwa). Un test par site non-défaut.
- **R2 — le filtre `?emissionChannel=` sur le schéma partagé `organizationScopedListQuerySchema` polluerait `GET /customers`** : mitigation : nouveau schéma `invoiceListQuerySchema` par extension, jamais toucher le schéma partagé.
- **R3 — `emissionChannel` contamine la signature de certification** : mitigation : critère de done dédié (grep `CertifiablePayload`) — le champ est ajouté APRÈS la construction du payload signé, comme `costPriceAtTime` (E7, précédent vérifié).
- **R4 — migration : `ADD COLUMN NOT NULL DEFAULT` sur une grosse table verrouille** : non pertinent ici (Postgres ≥ 11 ajoute une colonne avec DEFAULT constant sans réécrire la table ; volume dev négligeable de toute façon).
- **R5 — enum Prisma non référencé n'apparaît pas dans le client** : non pertinent — `EmissionChannel` EST référencé par `Invoice.emissionChannel`.
