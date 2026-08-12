# Plan : Authentification PIN pour le canal USSD (D2)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`).
- Persona affecté : tout utilisateur *620#, y compris téléphone emprunté (D2).
- Données sensibles : PIN 4 chiffres — jamais en clair, jamais loggé, jamais partagé même en accès délégué (context-facture-gn).
- Impact réglementaire : aucun direct.

## Investigation préalable

Spec USSD §3 (lue intégralement) :
- **3.1 Téléphone reconnu** : MSISDN détecté (table `UserPhone`, déjà existante ADR-087) → PIN direct.
- **3.2 Téléphone emprunté** : MSISDN inconnu → code compte (8 car. Base32) + PIN.
- **3.3** : PIN 4 chiffres, 3 essais puis blocage 30 min.

**Décisions déjà actées avec l'utilisateur** : le PIN se crée au premier accès *620# (pas depuis la PWA — inclut les utilisateurs 100% feature phone).

**Ambiguïté résolue par déduction** (aucun document ne le précise explicitement) : le "code compte" (§3.2) ne peut être que `Organization.accountCode` (seul champ 8 car. Base32 du schema, ADR-047, peuplé pour les organisations inscrites via le Chemin B assisté). Un compte étant lié à une ORGANISATION, pas directement à un individu, la résolution vers un UTILISATEUR (porteur d'un PIN) passe par le membre `owner` de cette organisation — cohérent avec les personas MVP (PME individuelles à propriétaire unique, Mariama/Fanta). Si une organisation a plusieurs owners (rare mais schéma-valide), le premier trouvé est utilisé — même limite déjà acceptée ailleurs dans ce repo (`dashboard/layout.tsx` : "prend la PREMIÈRE organisation... aucun sélecteur construit dans cette passe").

`Argon2PasswordService` existe déjà (B3, mot de passe) — réutilisé pour le PIN (même algorithme, même discipline ; le risque réel d'un PIN à 4 chiffres n'est pas la force du hash mais le brute-force ONLINE, mitigé par le blocage 3 essais/30 min, pas par argon2 lui-même). **`PASSWORD_SERVICE` n'est actuellement PAS exporté par `AuthModule`** (seul `AUTH_TOKEN_SERVICE` l'est, bien que le module soit `@Global()` — seuls les providers listés dans `exports` deviennent disponibles partout) : ajouté aux exports, changement minimal, aucun risque de régression (le provider existe déjà, juste pas encore partagé).

## Décision d'architecture

**`User`** : + `pinHash String?`, `pinFailedAttempts Int @default(0)`, `pinLockedUntil DateTime?`. Migration manuelle.

**`UssdAuthService`** (`ussd/ussd-auth.service.ts`) :
- `resolveByPhone(phone)` → `UserPhone.findUnique({msisdn})` → `{userId, hasPin}` ou `null`.
- `resolveByAccountCode(accountCode)` → `Organization.findUnique({accountCode})` puis `OrganizationMember.findFirst({organizationId, role: "owner", revokedAt: null})` → `{userId, organizationId, hasPin}` ou `null`.
- `createPin(userId, pin)` → hash (Argon2, réutilisé), reset `pinFailedAttempts`/`pinLockedUntil`. Aucune vérification de force du PIN au-delà du format (4 chiffres, déjà garanti par le DTO appelant) — un PIN "0000" reste un choix utilisateur valide, cohérent avec le modèle de menace réel (blocage après 3 essais, pas la force intrinsèque).
- `verifyPin(userId, pin)` → si `pinLockedUntil` dans le futur, retourne `{success: false, locked: true}` sans vérifier le hash. Sinon vérifie ; succès → reset `pinFailedAttempts` à 0 ; échec → incrémente, et au 3e échec pose `pinLockedUntil = now + 30min`.

**Câblage minimal dans `UssdSessionService`** (cette tâche ne construit AUCUNE option de menu authentifiée — options 1/3/4/5 restent "bientôt disponible" après authentification réussie, remplacées tâche par tâche) : un choix 1/3/4/5 à l'état `root` transite vers un sous-flux d'authentification (`auth:awaiting_pin` si téléphone reconnu, `auth:awaiting_account_code` sinon, puis `auth:awaiting_pin`, puis `auth:awaiting_pin_confirmation` si `hasPin` est faux — création). Succès → `session.userId`/`organizationId` peuplés, retour au menu choisi (toujours "bientôt disponible" pour l'instant).

## Alternatives écartées

**Un hasher dédié plus léger pour le PIN (vu son espace réduit, 10 000 valeurs)** — écartée : argon2 déjà en place, aucune raison d'introduire un 2e algorithme pour un gain de performance non mesuré comme nécessaire: la vraie protection est le compteur d'essais, pas le hash.

**Résoudre le "code compte" vers TOUS les membres de l'organisation (pas seulement owner)** — écartée : le code compte est un mécanisme de récupération d'accès au propriétaire (parcours "téléphone emprunté" des personas individuelles), pas un identifiant partagé d'équipe — élargir à tout membre romprait "aucun accès délégué ne partage jamais le PIN du propriétaire" (chaque collaborateur a son propre numéro reconnu, §3.1).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `schema.prisma` — `User.pinHash/pinFailedAttempts/pinLockedUntil`, migration ; `auth.module.ts` exporte `PASSWORD_SERVICE`
- [ ] Tâche 2 (RED) : `ussd-auth.service.spec.ts` — résolution téléphone reconnu/inconnu ; résolution code compte → owner ; création PIN ; vérification succès/échec ; blocage au 3e échec ; refus si déjà bloqué (sans re-décompter)
- [ ] Tâche 3 (GREEN) : `UssdAuthService`
- [ ] Tâche 4 : câblage minimal dans `UssdSessionService` (sous-flux auth avant tout choix 1/3/4/5)

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Un PIN correct après 2 échecs reste accepté (pas de blocage prématuré) ; un 3e échec bloque bien 30 min
- Aucun PIN en clair ne fuite dans un log ou une réponse

## Risques identifiés & mitigations
- Risque 1 : oubli de vérifier `pinLockedUntil` AVANT de décrémenter/vérifier le hash, permettant de contourner le blocage → mitigation : test explicite "refuse même avec le bon PIN si déjà bloqué".
- Risque 2 : `resolveByAccountCode` retournant un utilisateur d'une organisation dont l'appelant n'a pas prouvé la légitimité au-delà du code + PIN → risque déjà assumé par le design du code compte lui-même (ADR-046, secret partagé équivalent à un identifiant), pas un risque introduit par ce plan.
