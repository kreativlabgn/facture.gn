# Plan : Service RBAC partagé — accès organisation par membership OU mandat actif

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), `common/rbac/` — infrastructure transverse, pas un module métier.
- Persona affecté : indirect — prérequis technique pour que le personnel d'un cabinet comptable/CGA (F7, écosystème cabinet) consulte les factures/clients d'une organisation cliente (tâche suivante de la feuille de route dashboards).
- Données sensibles manipulées : autorisation d'accès à des factures/montants — pas de nouvelle donnée, mais élargit qui peut lire des données financières existantes.
- Impact réglementaire : aucun direct, mais toute erreur ici est une faille RBAC potentielle (même famille que la faille corrigée dans `roles.guard.ts`, commit `1c4d4b3`).

## Investigation préalable

`RolesGuard` (`common/rbac/roles.guard.ts`) ne vérifie QUE `OrganizationMember` — jamais `Mandate`. Un comptable externe (`MandateGrantedRole.accountant_external`) avec un mandat `active` sur une organisation cliente reçoit aujourd'hui un 403 sur toute route décorée `@Roles()` (ex. `GET /invoices?organizationId=`), même si son cabinet a un mandat légitime.

Un seul endroit du repo gère déjà ce double chemin : `FecService.assertAccess()` (`fec/fec.service.ts:41-59`) — vérifie `OrganizationMember` (rôle éligible + non révoqué), puis si absent, `Mandate` actif via `practice.members.some(userId, leftAt: null)`. Logique correcte et déjà testée (`fec.service.spec.ts`), mais **privée à `FecService`** — la dupliquer pour chaque futur endroit qui doit le même double chemin (prochaine tâche : factures/clients par organisation cliente) violerait DRY et risquerait une divergence silencieuse entre deux implémentations du même contrôle de sécurité.

## Décision d'architecture

Extraire la logique dans `common/rbac/organization-access.service.ts` :
```ts
@Injectable()
export class OrganizationAccessService {
  constructor(@Inject(PRISMA_CLIENT) prisma: PrismaClient) {}
  async assertAccess(organizationId: string, requesterUserId: string, eligibleRoles: OrganizationRole[]): Promise<void>
}
```
Signature identique à `FecService.assertAccess()` actuel, sauf `eligibleRoles` désormais un paramètre (FEC passait `FEC_ELIGIBLE_ROLES` en dur) — chaque appelant définit ses propres rôles éligibles, la logique du double chemin (membership puis mandat) reste unique et partagée.

Nouveau `common/rbac/organization-access.module.ts` exporte ce service (mirroir de `PrismaModule`, mais pas `@Global()` — contrairement à Prisma qui est un besoin universel, ce service n'est nécessaire qu'aux modules qui font ce contrôle précis ; import explicite plus lisible).

**`FecService` refactorisé** pour déléguer à ce service (garde `FEC_ELIGIBLE_ROLES` en constante locale, passée en paramètre). Comportement strictement identique — les appels `prisma.organizationMember.findUnique`/`prisma.mandate.findFirst` restent formés à l'identique, donc `fec.service.spec.ts` reste vert en construisant `OrganizationAccessService` réel autour du même mock Prisma (pas besoin de re-mocker un nouveau collaborateur).

## Alternatives écartées

**Étendre `RolesGuard` lui-même pour connaître `Mandate`** — écartée : `RolesGuard` est un `APP_GUARD` global appliqué à TOUTES les routes `@Roles()` existantes (40+ endpoints). Lui ajouter une notion de mandat changerait le comportement d'autorisation de routes qui n'ont jamais été conçues pour être accessibles par un cabinet (ex. `POST /invoices/:id/issue` — émettre une facture au nom du client reste hors scope de cette feuille de route). Un service explicite, appelé à la carte par les seuls endroits qui en ont besoin, est plus sûr qu'un changement de comportement global implicite.

**Dupliquer `assertAccess()` dans le futur contrôleur cabinet** — écartée, c'est exactement la duplication que ce plan évite.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `common/rbac/organization-access.service.spec.ts` — cas : membre rôle éligible autorise ; n'interroge jamais Mandate si membership suffit ; practice member avec mandat actif autorise ; refuse sans membership ni mandat ; refuse membre révoqué ; refuse membre avec rôle non éligible
- [ ] Tâche 2 (GREEN) : `common/rbac/organization-access.service.ts`
- [ ] Tâche 3 : `common/rbac/organization-access.module.ts`
- [ ] Tâche 4 (REFACTOR) : `fec.service.ts` délègue à `OrganizationAccessService` (injecté), `fec.module.ts` importe `OrganizationAccessModule`, `fec.service.spec.ts` mis à jour (construit `OrganizationAccessService` réel autour du mock Prisma existant)

## Critères de done
- Suite Jest trust-api complète verte (`pnpm --filter @facture-gn/trust-api test`)
- `fec.service.spec.ts` inchangé dans ses assertions métier (mêmes cas, même comportement), seule la construction change
- Aucune route existante ne change de comportement d'autorisation (ce service n'est câblé nulle part encore côté contrôleur hors FEC)

## Risques identifiés & mitigations
- Risque 1 : régression silencieuse sur FEC pendant le refactor → mitigation : `fec.service.spec.ts` reste la garde de non-régression, exécuté avant tout commit.
- Risque 2 : futur appelant oublie de restreindre `eligibleRoles` correctement (ex. inclut `cashier` là où seul `owner`/`admin` devrait lire des factures) → mitigation : chaque appelant définit sa propre constante nommée explicite (même pattern que `FEC_ELIGIBLE_ROLES`), jamais un défaut implicite large dans le service partagé lui-même.
