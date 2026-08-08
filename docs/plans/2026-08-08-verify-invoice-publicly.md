# Plan : Vérification publique d'une facture (A2)

## Contexte facture.gn
- Bounded context : Trust Context (Squad Trust) — nouveau module `verification`, lecture seule sur `Invoice`/`Organization`
- Persona affecté : n'importe qui (Ousmane, une banque, la DGI) — aucun compte, aucune session
- Données sensibles manipulées : aucune donnée personnelle (pas de PIN, pas de password_hash) ; expose en revanche des données financières de facture (totalTtc, statut) — à limiter au strict nécessaire pour la preuve de confiance
- Impact réglementaire : aucun (pas de traitement de données personnelles nouveau) ; c'est au contraire ce qui matérialise la promesse Trust Layer (tiers de confiance indépendant, ADR-041)

## Problème (en 3 lignes max)

Une facture certifiée (Ed25519 + chaînage SHA-256) n'a aujourd'hui aucun moyen d'être vérifiée depuis l'extérieur de facture.gn : aucun endpoint public n'existe. Quiconque reçoit une facture (banque, DGI, client) doit faire une confiance aveugle à l'émetteur, ce qui contredit le positionnement "tiers de confiance vérifiable" du produit.

## Solution retenue (en 5 lignes max)

Nouveau module `verification` (public, sans JWT) exposant `GET /verify/:certificationId`. Le service recherche la facture par `certificationId` (jamais par `id` interne — évite d'exposer l'UUID technique), puis **recompute** le payload canonique FGN-Canon-v1 à partir des champs actuellement stockés (`number`, `totalTtc`, `issuedAt`, `previousHash`, `organization.nif`) via `certification.certify()` (déterministe — même payload + même clé ⇒ même hash + même signature Ed25519, RFC 8032). Il compare ce résultat recalculé au triplet `hash`/`certificationId`/`signature` réellement stocké en base : une divergence signifie que les données ont été altérées après signature (tamper-evidence), pas seulement que la ligne existe en base. Réponse publique : `certificationId`, `number`, `organizationName`, `organizationNif`, `totalTtc`, `issuedAt`, `status`, `disputeStatus`, `validatedByAdministration`, `integrityValid` (booléen).

## Alternatives écartées

- **Étendre `invoices.controller` avec une route `@Public()`** : écarté — mélangerait les routes authentifiées RBAC (`create`/`issue`/`void`) et une route publique dans le même contrôleur, augmentant le risque qu'un futur guard global oublié laisse fuiter une route sensible. Un module `verification` séparé rend la surface publique explicite et auditable en un coup d'œil.
- **Vérifier uniquement la signature sur le hash stocké (`certification.verify()` seul, sans recomputer le hash depuis les champs actuels)** : écarté — ne détecterait pas une altération directe en base de `totalTtc`/`number`/`issuedAt` tant que la colonne `hash` n'est pas elle-même modifiée en cohérence ; recomputer le hash depuis les champs actuels et le comparer au hash stocké ferme ce trou.
- **Chercher par `id` interne (UUID) plutôt que `certificationId`** : écarté — l'UUID est un détail d'implémentation, `certificationId` (`GN-{NIF8}-{YYYY}-{HASH6}`) est le seul identifiant destiné à être imprimé/partagé publiquement (ADR-023).
- **Ajouter une méthode dédiée `recomputeHash()` à `CertificationService`** : écarté pour ce sprint — `certify()` est déjà déterministe (couvert par un test existant), donc suffisant sans toucher à l'interface stable du service (cf. TODO Cert-Engine Rust dans `certification.service.ts`).

## Découpage en tâches bite-sized (2–5 min chacune)

- [ ] Tâche 1 : `apps/trust-api/src/verification/verification.service.ts` — méthode `verifyByCertificationId(certificationId: string)` : lookup `prisma.invoice.findUnique({ where: { certificationId }, include: { organization: true } })`, `NotFoundException` générique si absent
- [ ] Tâche 2 : dans le même service — reconstruire le payload canonique depuis la facture trouvée, appeler `certification.certify(payload)`, comparer `hash`/`certificationId`/`signature` (hex) au triplet stocké → `integrityValid: boolean`
- [ ] Tâche 3 : `apps/trust-api/src/verification/verification.controller.ts` — `GET /verify/:certificationId`, `@Public()`, retourne le DTO de réponse (jamais l'`id` UUID interne ni les champs non listés dans la solution retenue)
- [ ] Tâche 4 : `apps/trust-api/src/verification/verification.module.ts` — déclare controller + service, importe `CERTIFICATION_SERVICE` (déjà `@Global()`, pas de nouvel import de provider nécessaire)
- [ ] Tâche 5 : `apps/trust-api/src/app.module.ts` — enregistrer `VerificationModule`
- [ ] Tâche 6 : `apps/trust-api/src/main.ts` — vérifier que `/verify` n'est pas déjà couvert par un guard global bloquant (JwtAuthGuard lit `@Public()`, donc pas de changement attendu, mais à confirmer en Tâche de vérif E2E)

## Tests à écrire AVANT le code

- [ ] Test 1 : `verification.service.spec.ts` — `certificationId` inconnu → `NotFoundException` (message générique, ne révèle pas si c'est l'id qui est invalide vs la facture non émise)
- [ ] Test 2 : `verification.service.spec.ts` — facture `issued` intacte → `integrityValid: true`, réponse contient `status`, `disputeStatus`, `validatedByAdministration`
- [ ] Test 3 : `verification.service.spec.ts` — facture avec `hash` altéré en base (simulé : mock Prisma renvoie un `hash` différent de celui recalculable depuis les autres champs) → `integrityValid: false`, la route répond quand même 200 (l'altération est un fait à afficher, pas une erreur HTTP)
- [ ] Test 4 : `verification.service.spec.ts` — facture `voided` reste vérifiable (le statut reflète honnêtement l'annulation, pas de blocage d'accès)
- [ ] Test 5 : test controller/e2e léger — `GET /verify/:certificationId` répond sans header `Authorization` (confirme le comportement `@Public()`, non-régression sur `JwtAuthGuard`)

## Critères de done

- [ ] Tous les tests verts (`pnpm turbo lint typecheck test`)
- [ ] Aucune donnée sensible exposée (pas d'`id` UUID interne, pas de `bankAccountDetails`, pas de données d'un autre invoice que celui demandé)
- [ ] Réponse jamais un 500 brut sur `certificationId` inexistant (404 propre, cohérent avec le pattern déjà établi sur `roles.guard`)
- [ ] Endpoint confirmé accessible sans JWT en HTTP réel (pas seulement via tests unitaires — leçon du sprint précédent, cf. `docs/plans/2026-08-08-auth-rbac-org-roles.md` §Vérification bout-en-bout)
- [ ] Aucune régression sur les routes existantes (`organizations`, `invoices`, `auth`)

## Risques identifiés & mitigations

- Risque 1 : oubli de `@Public()` → route bloquée par `JwtAuthGuard` global, endpoint inutilisable pour un vérificateur externe sans compte → mitigation : Test 5 + vérification manuelle HTTP réelle (curl sans header Authorization)
- Risque 2 : lookup par `id` interne au lieu de `certificationId` par erreur de copier-coller depuis `invoices.controller` → mitigation : Test 1 utilise explicitement un `certificationId` au format `GN-...`, jamais un UUID
- Risque 3 : `certification.certify()` régénère un nouveau payload légèrement différent de celui utilisé à l'émission (ex. `totalTtc` non reconverti en `BigInt` depuis Prisma) → hash recalculé différent même sans altération réelle → faux positif d'altération → mitigation : Test 2 (facture intacte ⇒ `integrityValid: true`) doit passer avec les vrais types Prisma (`BigInt`), pas des mocks simplifiés en `number`

## Vérification bout-en-bout prévue

`curl` sans header `Authorization` sur `GET /verify/{certificationId}` d'une facture réellement émise dans l'environnement de dev (issue via le parcours déjà vérifié du sprint précédent) → confirmer 200 + `integrityValid: true` ; puis sur un `certificationId` inventé → confirmer 404 propre.
