# Plan : B6 — Être reconnu sur plusieurs numéros de téléphone

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/auth/`
- Persona affecté : tout utilisateur avec un numéro personnel et un numéro professionnel (Mariama, marché *620#)
- Données sensibles manipulées : msisdn (déjà traité comme sensible depuis B1-B5)
- Impact réglementaire : aucun

## Problème (en 3 lignes max)
Un utilisateur ne peut être reconnu que par son numéro d'inscription — `register()` ne crée qu'une seule ligne `UserPhone`, aucun moyen d'en ajouter un second alors que le mécanisme de reconnaissance multi-numéro (`login()` résout déjà par n'importe quelle ligne `UserPhone`) fonctionne déjà.

## Solution retenue (en 5 lignes max)
`POST /auth/phones` (JWT requis) ajoute un numéro au compte de l'utilisateur authentifié. Réutilise `msisdnSchema` (déjà exporté depuis B3). Refuse (409, jamais un 500 brut) si le msisdn est déjà utilisé par n'importe quel compte — la contrainte `@unique` existante empêche structurellement un vol de numéro. Le nouveau numéro n'est jamais vérifié par OTP avant utilisation (`verifiedAt` reste `null`), cohérent avec le comportement déjà établi pour le numéro principal.

## Alternatives écartées
- **Vérification OTP du nouveau numéro avant activation** — écarté : aucune infra SMS/OTP n'existe dans ce codebase, et le numéro principal lui-même n'est jamais vérifié aujourd'hui — imposer une vérification uniquement pour le second numéro serait une incohérence arbitraire, pas une amélioration de sécurité réelle.
- **Endpoint "changer le numéro principal" / "lister mes numéros" / "supprimer un numéro"** — écarté : non requis par le backlog B6, YAGNI. `isPrimary` n'est lu nulle part dans le code (confirmé par grep) — purement informatif pour une future UI, pas un besoin fonctionnel actuel.
- **Construire le canal *620# (USSD réel)** — écarté : c'est le périmètre de D1-D4, une story séparée. B6 livre la brique API dont USSD dépendra, pas le canal lui-même.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `apps/trust-api/src/auth/dto/add-phone.dto.ts` (nouveau) — `{ msisdn }`, réutilise `msisdnSchema` importé de `register.dto.ts`
- [ ] Tâche 2 : `apps/trust-api/src/auth/auth.service.ts` — nouvelle méthode `addPhone(userId, msisdn)` : crée `UserPhone(userId, msisdn, isPrimary: false)`, catch `isUniqueConstraintViolation(error, "msisdn")` → `ConflictException` explicite
- [ ] Tâche 3 : `apps/trust-api/src/auth/auth.controller.ts` — route `POST /auth/phones`, JWT requis (pas de `@Public()`), `@CurrentUser()`

## Tests à écrire AVANT le code
- [ ] Test 1 : `auth.service.spec.ts` — `addPhone()` crée un `UserPhone` avec `isPrimary: false` pour l'utilisateur donné
- [ ] Test 2 : `auth.service.spec.ts` — `addPhone()` refuse un msisdn déjà utilisé par n'importe quel compte (409 explicite, jamais un 500 brut)
- [ ] Test 3 : E2E réel — un utilisateur enregistré avec un numéro ajoute un second numéro, puis se connecte avec CE second numéro (preuve que `login()` déjà existant reconnaît bien la nouvelle ligne sans aucune modification)

## Critères de done
- Tous les tests verts (suite complète)
- Build/lint/typecheck verts
- Vérification E2E réelle : ajout d'un second numéro → login réussi avec ce second numéro → tentative d'ajouter un numéro déjà pris (par soi-même ou un autre compte) → 409
- `dev-code-reviewer` OK
- `dev-security-reviewer` recommandé (msisdn, mécanisme d'authentification)

## Risques identifiés & mitigations
- **Risque** : un utilisateur ajoute le numéro d'un autre compte, créant une ambiguïté de connexion. **Mitigation** : `UserPhone.msisdn` déjà `@unique` en base — structurellement impossible, testé explicitement (Test 2).
- **Risque** : confondre ce nouvel endpoint avec un mécanisme de vérification d'identité. **Mitigation** : comportement identique et cohérent avec le numéro principal (jamais de vérification OTP aujourd'hui) — pas une régression de posture de sécurité, juste une extension du même modèle de confiance déjà en place.
