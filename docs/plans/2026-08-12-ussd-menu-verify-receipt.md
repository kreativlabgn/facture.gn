# Plan : Option 2 USSD — Vérifier un reçu

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`) — réutilise `VerificationService` existant (déjà utilisé par `GET /verify/:certificationId`, page publique PWA).
- Persona affecté : payeur ou marchand sur feature phone, aucune authentification requise (§2.2 Spec USSD).
- Données sensibles : aucune nouvelle — mêmes données déjà publiques via la vérification PWA.

## Investigation préalable

§2.2 : « Aucune authentification requise. Affiche le statut de contestation si différent de « none ». » `VerificationService.verifyByCertificationId(certificationId)` existe déjà, retourne exactement les champs nécessaires (`number`, `totalTtc`, `status`, `disputeStatus`, `integrityValid`). Aucune nouvelle logique métier — uniquement un nouvel habillage texte USSD autour d'un service déjà éprouvé.

## Décision d'architecture

Deux nouveaux états dans `UssdSessionService` :
- `root`, input `"2"` → transition `verify_awaiting_code`, prompt "Entrez l'identifiant de vérification :".
- `verify_awaiting_code`, input = certificationId → `VerificationService.verifyByCertificationId()`. `NotFoundException` interceptée → « Aucune facture ne correspond à cet identifiant. » (`continue: false`). Trouvée → texte formaté (numéro, montant, statut, ligne contestation SI `disputeStatus !== "none"`), `continue: false`.

Formatage du montant en texte USSD (pas de `Intl.NumberFormat`, environnement Node sans garantie de locale complète) : division entière centimes→GNF + séparateur de milliers manuel, cohérent avec `formatGnf` déjà utilisé côté web (mêmes centimes GNF, juste une sérialisation texte différente pour un canal contraint).

## Alternatives écartées

**Dupliquer la logique de vérification/recalcul cryptographique dans le module USSD** — écartée, aucune raison de ne pas réutiliser `VerificationService` tel quel, seul l'habillage texte change.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `ussd-session.service.spec.ts` — option 2 → prompt ; identifiant valide → texte avec montant/statut ; contestation affichée seulement si ≠ none ; identifiant invalide → message d'échec, `continue:false`
- [ ] Tâche 2 (GREEN) : câblage dans `UssdSessionService` + petit formateur GNF local

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Aucune authentification requise sur ce chemin (vérifié : aucun appel à `UssdAuthService` dans cette branche)

## Risques identifiés & mitigations
- Aucun — réutilisation d'un service déjà testé, seule la présentation change.
