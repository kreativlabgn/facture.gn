# Plan : Accéder aux formules payantes sans attendre la vérification DGI (H2, MUST)

## Contexte projet
- Module : Trust Context — `apps/trust-api/src/organizations/`
- Persona affecté : owner/admin de la PME (choisit son palier commercial)
- Données sensibles manipulées : aucune
- Impact réglementaire : aucun

## Clarifications
- Q: Downgrade autorisé, ou seulement upgrade ? → R (défaut) : les deux — aucune règle métier documentée n'interdit un downgrade, symétrique à un upgrade.
- Q: Faut-il tracer qui a changé le palier et quand (audit) ? → R (défaut) : non — pas demandé, pas de précédent obligatoire pour ce type de changement non financier (contrairement à `CreditLimitChangeRequest`, qui déclenche une approbation parce qu'il touche un risque de crédit réel).
- Q: Un `InvoiceEventType` doit-il être émis ? → R (défaut) : non — `commercialTier` n'est pas lié au cycle de vie d'une facture (contrairement à `financing_disbursed`), aucune entrée `EVENT_CATEGORY_BY_TYPE` à ajouter.
- Q: Le palier demandé doit-il être validé contre les valeurs connues ? → R : oui, Zod `z.nativeEnum` sur l'enum Prisma `CommercialTier` déjà existant.

## Problème (en 3 lignes max)
ADR-049 acte que le palier commercial "n'est jamais dépendant de DGI" — mais aucun mécanisme ne permet à ce jour de changer `Organization.commercialTier` (champ jamais écrit ailleurs que son défaut `freemium`). H2 doit construire ce mécanisme manquant, en veillant explicitement à ne jamais le coupler à `dgiVerificationStatus`.

## Solution retenue (en 5 lignes max)
Nouveau `POST /organizations/:id/commercial-tier` (`@Roles("owner","admin")`, `@OrganizationIdSource("organization")`) → `OrganizationsService.upgradeCommercialTier(organizationId, tier)` qui pose directement `commercialTier = tier`, sans aucune lecture de `dgiVerificationStatus`. Aucun traitement de paiement réel (même limite déjà acceptée pour H4/K4/K5 — pas d'infrastructure de facturation récurrente dans ce repo).

## Alternatives écartées
- **Exiger `dgiVerificationStatus === "verified"` avant upgrade** — écarté explicitement, c'est exactement ce qu'ADR-049 interdit.
- **Ajouter une entité de demande/approbation (comme `CreditLimitChangeRequest`)** — écarté, aucun risque de crédit ici, un changement de palier commercial est une décision unilatérale normale du propriétaire de son propre abonnement.

## Découpage en tâches bite-sized
- [ ] [P] Tâche 1 : `apps/trust-api/src/organizations/dto/upgrade-commercial-tier.dto.ts` — `{ tier: z.nativeEnum(CommercialTier) }` + spec
- [ ] Tâche 2 : `OrganizationsService.upgradeCommercialTier()` + spec (accepte tout palier, y compris pour une organisation `unverified`)
- [ ] Tâche 3 : endpoint `organizations.controller.ts` + wiring RBAC

## Tests à écrire AVANT le code
- [ ] DTO : accepte les 5 valeurs de `CommercialTier`, rejette une valeur inconnue
- [ ] Service : pose `commercialTier` demandé quel que soit `dgiVerificationStatus` (test dédié avec `unverified`) — assertion explicite qu'aucune lecture de ce champ n'intervient dans la décision
- [ ] Service : accepte un downgrade (pro → freemium) sans erreur

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- Tous les tests verts
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : régression sur les gates H1 (`plan-features-grid.ts`) si un tier invalide est écrit → mitigation : Zod valide contre l'enum Prisma avant toute écriture.
