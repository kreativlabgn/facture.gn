# Plan : Infrastructure de session USSD *620#

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`, nouveau) — D1-D4 sont classées Trust Context dans le DAT (§ "Trust Layer complet... USSD *620#" listé dans le périmètre MVP Trust).
- Persona affecté : agent terrain/PME sur feature phone (Mariama, Fanta — personas explicitement feature-phone-only).
- Données sensibles : numéro de téléphone, montants — pas de nouvelle catégorie.
- Impact réglementaire : §7 Spec USSD — journalisation MSISDN/IMEI/horodatage/montant pour CENTIF (LBC/FT), même régime que G1 déjà en place.

## Investigation préalable

`V/Spec-USSD-facture-gn.md` (lu intégralement) est la référence exhaustive : menu canonique 1-5 (+ option 6 V1, hors scope), authentification §3, paliers de vélocité §4. Aucun agrégateur USSD réel n'est disponible dans cet environnement (aucun credential, comme Djomy/Moneroo) — ce plan construit un contrat webhook STUB propre, pas une réplique du protocole exact d'un agrégateur réel (ex. Africa's Talking, qui accumule tout l'historique de saisie dans un champ `text` séparé par `*` et répond par un préfixe `CON`/`END`) : même discipline que `DjomyStubProvider`, qui expose une interface propre (`CreatePaymentLinkResult`) plutôt que de simuler le JSON exact de l'API Djomy réelle. Un futur adaptateur agrégateur traduira entre le vrai protocole et ce contrat interne.

Aucun Redis/BullMQ dans ce repo (vérifié, aucune dépendance dans `apps/*/package.json`) — décision utilisateur : session en table Postgres dédiée, TTL court (session USSD réelle < 90s par story, quelques minutes de marge).

## Décision d'architecture

**Contrat webhook stub** (`POST /ussd/session`) :
```ts
// Requête
{ sessionId: string; phone: string; input: string } // input = SEULE la dernière saisie, jamais l'historique cumulé
// Réponse
{ continue: boolean; text: string } // continue=false = fin de session (équivalent END), true = équivalent CON
```

**`UssdSession`** (nouveau modèle Prisma) :
```
id, sessionId (unique), phone, state (string — étape courante de la machine à états),
contextData (Json? — données accumulées entre étapes : montant saisi, customerId choisi...),
userId (nullable — peuplé après authentification, tâche suivante),
organizationId (nullable — idem),
createdAt, expiresAt (courte, quelques minutes)
```

**`UssdSessionService.handleRequest(sessionId, phone, input)`** : charge la session par `sessionId` (crée si absente, `state: "root"`), dispatch selon `state` (switch — même style que la "machine à états" déjà pratiquée dans `InvoicesService`, extensible tâche par tâche). Pour CETTE tâche uniquement : affiche le menu canonique (§1 Spec USSD) à l'état `root`, et pour tout choix 1-5 à ce stade, répond « Fonctionnalité bientôt disponible » (`continue: false`) — les tâches suivantes de la feuille de route USSD remplaceront chaque branche une par une.

**Expiration** : toute session dont `expiresAt < now()` au moment d'une nouvelle requête portant le même `sessionId` est traitée comme une session NEUVE (recréée, jamais une erreur) — cohérent avec le comportement réel d'un agrégateur qui réutilise parfois un `sessionId` après un timeout réseau.

## Alternatives écartées

**Répliquer exactement le protocole Africa's Talking (texte cumulé, préfixe CON/END)** — écartée : aucun agrégateur choisi/contracté à ce stade (deal Orange "en chiffrage" par le doc lui-même), répliquer un protocole précis maintenant créerait un couplage prématuré à un choix non encore fait. Le contrat stub actuel se traduit trivialement vers n'importe quel agrégateur réel le moment venu (adaptateur fin, jamais une réécriture).

**Redis pour l'état de session** — écartée, décision utilisateur (cohérence avec l'absence de toute autre infra Redis dans ce repo à ce jour).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `schema.prisma` — `UssdSession`, migration
- [ ] Tâche 2 (RED) : `ussd-session.service.spec.ts` — crée une session neuve à `root` avec le menu canonique ; recharge une session existante par `sessionId` ; recrée si `expiresAt` dépassé ; réponse "bientôt disponible" pour un choix 1-5 à `root`
- [ ] Tâche 3 (GREEN) : `UssdSessionService`
- [ ] Tâche 4 : `ussd.controller.ts` (`POST /ussd/session`, `@Public()` — jamais de JWT, l'appelant est l'agrégateur), `ussd.module.ts`

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Une requête avec un `sessionId` inconnu crée toujours une session neuve, jamais une erreur

## Risques identifiés & mitigations
- Risque 1 : contrat stub qui ne correspondrait à aucun agrégateur réel guinéen une fois choisi → mitigation : contrat volontairement minimal (3 champs requête, 2 champs réponse), traduction triviale vers CON/END + texte cumulé par un futur adaptateur fin, sans toucher à la logique métier de `UssdSessionService`.
