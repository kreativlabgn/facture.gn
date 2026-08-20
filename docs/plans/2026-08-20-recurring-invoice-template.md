# Plan : Générer automatiquement une facture depuis un modèle récurrent (I1, SHOULD, ADR-056)

## Contexte projet
- Module : Trust Context — nouveau `apps/trust-api/src/recurring-templates/`, consomme `InvoicesService.createDraft()` (cross-module, précédent déjà établi)
- Persona affecté : owner/admin/accountant_internal/cashier/field_agent (PME avec client sous contrat régulier)
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun direct (le régime fiscal reste géré exclusivement par `createDraft()`, déjà conforme C4/ADR-033)

## Clarifications
- Q: La facture générée est-elle un draft ou émise (`issue()`) automatiquement ? → R (défaut) : draft uniquement — jamais une émission automatique surprise, la PME reste responsable de la revue/émission, cohérent avec A1 (draft toujours distinct de `issue()`).
- Q: `documentType` du template ? → R (défaut) : toujours `"invoice"` — jamais proforma/quote pour un modèle récurrent (n'a pas de sens métier).
- Q: Faut-il empêcher une génération "trop tôt" (avant l'intervalle défini) ? → R : oui — `ConflictException` si `lastGeneratedAt + intervalDays > maintenant`, sinon deux déclenchements rapprochés dupliqueraient la facture pour la même période (même rigueur que l'idempotence mensuelle de H4).
- Q: Le template est-il modifiable/désactivable après création ? → R (défaut) : non — hors scope, non demandé (YAGNI). Une future story pourra l'ajouter si un besoin réel apparaît.
- Q: Comment détecter un `regime_change` à signaler (ADR-056) ? → R : comparer `organization.regimeFiscal` au moment de la génération contre `template.lastKnownRegimeFiscal` (initialisé au régime de l'organisation à la création du template, mis à jour après chaque génération) — si différent, émettre `InvoiceEvent(type: "regime_change")` sur la facture nouvellement créée, jamais bloquant.

## Problème (en 3 lignes max)
Une PME avec un client sous contrat régulier doit recréer manuellement une facture identique à intervalle défini. ADR-056 exige que ce raccourci ne fige jamais un taux/régime fiscal sur le modèle — la génération doit toujours recalculer le régime en vigueur au moment de l'émission, avec une alerte de revue si le régime a changé depuis la dernière génération.

## Solution retenue (en 5 lignes max)
Nouveau modèle `RecurringInvoiceTemplate` (customerId?, branchId?, lines en JSON, discountPct, intervalDays, lastGeneratedAt?, lastKnownRegimeFiscal) — jamais de taux/régime figé stocké. `POST /organizations/:id/recurring-templates` crée le template (régime capturé pour référence future, pas pour figer le calcul). `POST /recurring-templates/:id/generate` appelle `InvoicesService.createDraft()` directement (jamais dupliqué — recalcule déjà le régime fiscal frais à chaque appel, C4), compare le régime obtenu à `lastKnownRegimeFiscal` et émet `regime_change` si différent, puis met à jour `lastGeneratedAt`/`lastKnownRegimeFiscal`.

## Alternatives écartées
- **Cron/scheduling automatique** — écarté, aucune infrastructure de ce type n'existe dans ce repo ; même descoping déjà accepté par l'utilisateur pour H4 (génération manuelle uniquement).
- **Dupliquer la logique de `createDraft()` dans le nouveau service** — écarté explicitement, violerait la convention "no duplication" (Agent 3) et créerait un second chemin de calcul de régime fiscal à maintenir en synchronisation avec C4/ADR-033.
- **Émission automatique (`issue()`) directe depuis le template** — écarté, une facture générée reste un draft à valider par la PME, jamais une certification surprise.

## Découpage en tâches bite-sized
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — modèle `RecurringInvoiceTemplate` + migration hand-written
- [ ] Tâche 2 : `apps/trust-api/src/recurring-templates/dto/create-recurring-template.dto.ts` + spec
- [ ] Tâche 3 : `RecurringTemplatesService.create()` + spec
- [ ] Tâche 4 : `RecurringTemplatesService.generate()` + spec (appelle `InvoicesService.createDraft()`, garde d'intervalle, émission `regime_change`)
- [ ] Tâche 5 : `recurring-templates.controller.ts` (2 endpoints) + `recurring-templates.module.ts` (importe `InvoicesModule`) + wiring `app.module.ts`
- [ ] Tâche 6 : nouvelle source `@OrganizationIdSource("recurring-template")` sur `RolesGuard`/`organization-id-source.decorator.ts` (pattern déjà établi E5/E6)

## Tests à écrire AVANT le code
- [ ] `create()` : capture `lastKnownRegimeFiscal` = régime actuel de l'organisation, `lastGeneratedAt` = null
- [ ] `generate()` : appelle `InvoicesService.createDraft()` avec les champs du template, `documentType: "invoice"` toujours
- [ ] `generate()` : rejette (`ConflictException`) si appelée avant `lastGeneratedAt + intervalDays`
- [ ] `generate()` : émet `regime_change` si le régime de l'organisation diffère de `lastKnownRegimeFiscal`
- [ ] `generate()` : n'émet AUCUN événement si le régime est inchangé
- [ ] `generate()` : met à jour `lastGeneratedAt`/`lastKnownRegimeFiscal` après succès

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- Tous les tests verts (nouveaux + non-régression complète sur `invoices.service.spec.ts`, `organizations.service.ts::EVENT_CATEGORY_BY_TYPE`)
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : régression sur `createDraft()` (chemin critique certifié) → mitigation : ce module ne modifie JAMAIS `invoices.service.ts`, uniquement un appel externe à sa méthode publique déjà stable.
- Risque 2 : double génération sous concurrence (deux requêtes simultanées avant la mise à jour de `lastGeneratedAt`) → à évaluer en revue (même classe de risque que le TOCTOU H1, non bloquant si l'impact reste "une facture en trop", jamais une corruption de données).
