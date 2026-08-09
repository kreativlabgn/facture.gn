# Plan : Inscription self-service avec NIF/eTax optionnels (B1/B4)

## Contexte facture.gn
- Bounded context : Trust Context — `organizations` (DTO, service), `certification` (helper partagé), `invoices`, `verification`
- Persona affecté : Aissatou (boutique connectée), Aminata (freelance) — Chemin A, self-service PWA
- Données sensibles manipulées : NIF (déjà traité avec rigueur ailleurs dans le projet) — aucune nouvelle donnée sensible introduite
- Impact réglementaire : ADR-035/036/049 (jamais un gate DGI sur l'usage de base), cohérence avec le positionnement "tiers de confiance" (PRD §1.2) — la vérification publique doit toujours refléter l'état réel, jamais un placeholder interne

## Problème (en 3 lignes max)

`create-organization.dto.ts` rend `nif` obligatoire, contredisant directement B4 ("NIF+eTax optionnels → statut unverified, TTV < 5 min") et ADR-036 ("usage de base jamais bloqué"). Le schéma DB (`Organization.nif String @unique` NOT NULL) empêcherait de toute façon l'inscription sans NIF même si le DTO était corrigé seul.

## Solution retenue (en 5 lignes max)

`nif`/`etaxNumber` deviennent optionnels dans le DTO (validation `.refine()` : les deux ensemble ou aucun, ADR-035) et `Organization.nif` devient nullable en base (même pattern que `Invoice.number`, Postgres autorise plusieurs `NULL` sans violer l'unicité). **Point bloquant traité dans ce même plan** : `organization.nif` alimente directement `certification_id` (`GN-{NIF8}-{YYYY}-{HASH6}`) — un `nif` null ferait planter la première émission de facture, cassant la promesse même de B4. Un helper `resolveNifForCertification()` (module `certification`) substitue un placeholder fixe 8 caractères (`UNVERIFI`) **uniquement pour la construction interne du hash/certification_id**, jamais exposé comme un vrai NIF : `GET /verify` continue de retourner le NIF réel de l'organisation (potentiellement `null`), honnêteté envers un vérificateur externe.

## Alternatives écartées

- **Bloquer l'émission de facture tant que le NIF n'est pas renseigné** : écarté — viole frontalement ADR-036 ("usage de base jamais bloqué") et la promesse TTV<5min du Parcours 0 Chemin A ("première facture émise en moins de 5 minutes depuis l'ouverture de l'app").
- **Utiliser l'UUID de l'organisation (ou un hash de celui-ci) comme substitut au lieu d'un placeholder fixe** : écarté — un placeholder fixe et documenté (`UNVERIFI`) est immédiatement reconnaissable comme "organisation non vérifiée" par quiconque lit un `certification_id`, alors qu'un hash d'UUID ressemblerait à un vrai NIF tronqué, risquant de tromper un vérificateur externe (contraire à PRD §1.2).
- **Étendre ce plan pour construire un flow de complétion de profil (ajouter le NIF après coup) ou la vérification DGI automatique (B2)** : écarté — ce sont des stories distinctes du backlog (B2 notamment), non demandées ici. Ce plan se limite strictement à rendre l'inscription initiale non bloquante.
- **Traiter le Chemin B (inscription assistée terrain, `assisted_session`)** : écarté — story distincte (F2/Parcours 0 §1.2), NIF optionnel s'y appliquera de la même façon une fois cette story attaquée, mais `assisted_session` n'existe pas dans le schéma actuel.

## Découpage en tâches bite-sized (2–5 min chacune)

- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — `Organization.nif` : `String @unique` → `String? @unique`
- [ ] Tâche 2 : migration Prisma (procédure manuelle habituelle)
- [ ] Tâche 3 : `apps/trust-api/src/organizations/dto/create-organization.dto.ts` — `nif`/`etaxNumber` optionnels (`.min(1).optional()`), `.refine()` : les deux ensemble ou aucun (ADR-035)
- [ ] Tâche 4 : `apps/trust-api/src/certification/certification.service.ts` — export `UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER` (8 caractères) + `resolveNifForCertification(nif: string | null): string`
- [ ] Tâche 5 : `apps/trust-api/src/invoices/invoices.service.ts:77` — utilise `resolveNifForCertification(organization.nif)` au lieu de `organization.nif` brut
- [ ] Tâche 6 : `apps/trust-api/src/verification/verification.service.ts` — utilise le helper pour le recompute interne (ligne 46) ; `PublicInvoiceVerification.organizationNif` devient `string | null`, retourne `invoice.organization.nif` réel (ligne 62, jamais le placeholder)
- [ ] Tâche 7 : `apps/trust-api/src/organizations/organizations.service.ts` — vérifier que le message d'erreur de conflit NIF reste correct (inatteignable avec `nif` absent, mais à confirmer par test)

## Tests à écrire AVANT le code

- [ ] Test 1 : `create-organization.dto.spec.ts` — accepte une organisation sans `nif` ni `etaxNumber` ; rejette `nif` seul sans `etaxNumber` ; rejette `etaxNumber` seul sans `nif` ; accepte les deux ensemble (comportement existant, non-régression)
- [ ] Test 2 : `organizations.service.spec.ts` — crée une organisation sans NIF avec succès, `dgiVerificationStatus` reste `unverified` par défaut (non-régression)
- [ ] Test 3 : `certification.service.spec.ts` (nouveau bloc) — `resolveNifForCertification(null)` retourne le placeholder 8 caractères ; `resolveNifForCertification("GN12345678")` retourne le NIF inchangé
- [ ] Test 4 : `invoices.service.spec.ts` — `issue()` sur une facture d'une organisation sans NIF réussit, le `certificationId` contient le placeholder à la position attendue
- [ ] Test 5 : `verification.service.spec.ts` — `verifyByCertificationId()` sur une facture d'une organisation sans NIF : `integrityValid: true` (le recompute utilise le même placeholder qu'à l'émission) ET `organizationNif: null` dans la réponse publique (jamais le placeholder exposé)

## Critères de done

- [ ] Tous les tests verts (`pnpm turbo lint typecheck test`)
- [ ] Migration Prisma appliquée proprement
- [ ] Vérification E2E réelle : inscription sans NIF ni eTax → émission immédiate d'une facture certifiée → `GET /verify` confirme `integrityValid: true` et `organizationNif: null`
- [ ] Aucune régression sur les organisations avec NIF (parcours existant inchangé)
- [ ] `dev-code-reviewer` passé sur le diff

## Risques identifiés & mitigations

- Risque 1 : une organisation avec NIF et une organisation sans NIF émettant leur première facture la même année produiraient des `certification_id` avec le même préfixe `GN-UNVERIFI-2026-...` si DEUX organisations sont toutes deux sans NIF → mitigation : le `HASH6` final (dérivé du contenu complet signé, distinct par facture) garantit l'unicité du `certification_id` complet, exactement comme `Invoice.number` reste unique par organisation malgré un préfixe partagé — pas une régression, cohérent avec le design déjà en place
- Risque 2 : le placeholder `UNVERIFI` pourrait un jour entrer en collision avec un vrai NIF guinéen commençant par ces 8 caractères → mitigation : format NIF guinéen numérique (déjà vu dans les exemples : `GN12345678`), `UNVERIFI` n'est pas un préfixe numérique valide, collision structurellement impossible
- Risque 3 : oubli d'un troisième call site utilisant `organization.nif` directement → mitigation : déjà vérifié par grep exhaustif avant ce plan (3 occurrences trouvées, toutes listées dans les tâches), le typecheck lèvera une erreur si un site est oublié (nif devient `string | null`)

## Vérification bout-en-bout prévue

`POST /organizations` sans `nif` ni `etaxNumber` → succès, `dgiVerificationStatus: unverified`. `POST /invoices` puis `POST /invoices/:id/issue` sur cette organisation → succès, `certificationId` contient `UNVERIFI`. `GET /verify/:certificationId` → `integrityValid: true`, `organizationNif: null` dans la réponse (jamais `UNVERIFI` exposé publiquement).
