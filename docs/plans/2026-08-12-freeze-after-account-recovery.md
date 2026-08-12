# Plan : Geler l'émission de factures après une récupération de compte (G2, réinterprété)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — `auth/auth.service.ts` (déclenchement) et `invoices/invoices.service.ts` (application).
- Persona affecté : le système, en défense d'une organisation venant de vivre une récupération de compte owner (B3) — fenêtre de vulnérabilité la plus proche d'une prise de contrôle frauduleuse.
- Données sensibles : aucune nouvelle, mais protège directement contre un scénario de fraude post-ATO (Account Takeover).
- Impact réglementaire : aucun direct.

## Investigation préalable

Backlog (texte exact, intégralement) : *"G2 — Geler temporairement les plafonds après un reset PIN `[MUST]`"* — aucune autre ligne, aucun ADR référencé (seule story du backlog sans description ni référence). Le code n'a ni PIN (auth = msisdn + mot de passe, `auth.service.ts`) ni concept de "plafond" (`grep -rn "plafond"` sur tout `apps/trust-api/src` : zéro résultat). Décision utilisateur explicite : réinterpréter comme un gel temporaire des paiements sortants/émission de facture après une récupération de compte APPROUVÉE (`AuthService.resolveRecovery()`, decision `"approved"`), fenêtre la plus proche de l'intention d'origine (compte venant de changer de mot de passe = moment de plus haute suspicion).

`AuthService.resolveRecovery()` (déjà existant, B3) : sur `decision === "approved"`, génère un mot de passe temporaire pour `request.userId`, dans une transaction. `request.organizationId` est déjà disponible à ce point — c'est le point d'injection naturel du gel.

`InvoicesService.issue()` (déjà existant) : récupère déjà `organization` en mémoire (`findUniqueOrThrow`) avant de procéder — point d'injection naturel de la vérification, aucune requête supplémentaire nécessaire.

## Décision d'architecture

**Nouveau champ `Organization.paymentsFrozenUntil` (`DateTime?`, nullable)** — `null` = jamais gelé ou gel expiré (pas de nettoyage actif nécessaire, la vérification compare toujours à `now()`). Migration manuelle (`ALTER TABLE "organization" ADD COLUMN "payments_frozen_until" TIMESTAMP(3)`), même style que les migrations précédentes de ce repo (pas de DB locale démarrée pour générer via `prisma migrate dev`).

**`FREEZE_WINDOW_HOURS = 24`** (constante nommée, `auth.service.ts`) — 24h choisi comme valeur MVP raisonnable (fenêtre de vigilance active sans bloquer l'activité commerciale plus d'une journée), pas de signal backlog pour une valeur précise (G2 n'en donne aucune).

**`resolveRecovery()`** : dans la même transaction que la génération du mot de passe temporaire (decision `"approved"` uniquement), `tx.organization.update({ where: { id: request.organizationId }, data: { paymentsFrozenUntil: new Date(Date.now() + FREEZE_WINDOW_HOURS * 3600_000) } })`.

**`InvoicesService.issue()`** : juste après avoir chargé `organization`, si `organization.paymentsFrozenUntil` est non-null ET dans le futur (`> new Date()`), lève `ForbiddenException` avec un message explicite ("émission gelée temporairement suite à une récupération de compte récente"). Un mandat cabinet n'est pas concerné différemment — le gel porte sur l'organisation elle-même, quel que soit qui tente d'émettre.

## Alternatives écartées

**Geler aussi la création de lien de paiement (money-api) séparément** — écartée pour cette passe : `issue()` est le seul chemin qui mène à un lien de paiement (`feat/wire-payment-link-to-issuance`, déjà mergé) — bloquer `issue()` bloque transitivement toute nouvelle création de lien. Dupliquer la vérification côté money-api ajouterait un appel réseau (`InternalAuthGuard`) sans bénéfice, l'invariant est déjà garanti en amont.

**Bloquer aussi l'ÉMISSION de factures DÉJÀ émises avant la récupération** (paiements entrants sur factures existantes) — écarté, hors du texte du backlog ("émission" au sens strict) et casserait l'expérience d'un client légitime qui doit continuer à payer une facture déjà envoyée avant l'incident.

**Nettoyage actif (cron) de `paymentsFrozenUntil` expiré** — écarté, YAGNI : la vérification compare toujours à `now()`, une valeur passée est déjà inoffensive, un cron de nettoyage n'apporterait aucun comportement nouveau.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `schema.prisma` — `Organization.paymentsFrozenUntil DateTime?`, migration SQL manuelle
- [ ] Tâche 2 (RED) : `auth.service.spec.ts` — `resolveRecovery()` avec decision "approved" gèle l'organisation 24h ; decision "rejected" ne gèle jamais
- [ ] Tâche 3 (GREEN) : `AuthService.resolveRecovery()` mis à jour
- [ ] Tâche 4 (RED) : `invoices.service.spec.ts` — `issue()` refuse si `paymentsFrozenUntil` dans le futur ; autorise si `null` ou dans le passé
- [ ] Tâche 5 (GREEN) : `InvoicesService.issue()` mis à jour

## Critères de done
- Suite trust-api verte
- Une organisation avec `paymentsFrozenUntil` expiré (passé) émet normalement — pas de faux positif permanent

## Risques identifiés & mitigations
- Risque 1 : un owner légitime bloqué 24h après avoir lui-même récupéré son compte pourrait percevoir ça comme un bug plutôt qu'une protection → mitigation : message d'erreur explicite (pas une 403 générique) nommant la cause et la durée.
- Risque 2 : oubli de couvrir un autre chemin d'émission (assisté, `createAssisted`+`issue` séparés ou combinés ?) → vérifié : `createAssisted()` crée un draft, l'émission passe toujours par `issue()` (même chemin), donc déjà couvert.
