# Plan : Provisionner la clé racine d'une organisation (A3)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — changement fondamental à la certification, touche `invoices.service.ts:issue()`, `verification.service.ts`, les 3 chemins de création d'organisation (`create()`/`createAssisted()`/`createFromApip()`)
- Persona affecté : "le système" (backlog explicite) — aucune action utilisateur directe, mais impacte la confiance de TOUT vérificateur externe (le cœur du positionnement "tiers de confiance" de facture.gn)
- Données sensibles manipulées : clé privée Ed25519 par organisation (nouvelle catégorie de secret, la plus sensible de tout ce repo — équivalent cryptographique d'une signature manuscrite légale)
- Impact réglementaire : direct — c'est le mécanisme qui rend une facture "certifiée" au sens du positionnement produit

## Investigation préalable

Backlog (texte exact) : *"A3 — Provisionner la clé racine d'une organisation `[MUST]`. En tant que système, je veux générer une clé racine Ed25519 en HSM, afin de garantir une identité cryptographique unique. - Génération HSM cloud, jamais exportée. Réf : ADR-026."*

ADR-026 (texte exact) : *"Clé déléguée par organisation et par canal. Décision : Certificat de délégation signé par la clé racine. Conséquences : Révocation par canal possible."*

**État réel du code (vérifié en lisant `certification.service.ts`/`certification.module.ts` intégralement)** : la cryptographie Ed25519 est authentique (`@noble/curves/ed25519`, RFC 8785 JCS, SHA-256) — chaque facture émise cette session a été réellement signée et réellement vérifiable via `GET /verify/:certificationId`. Mais **une seule clé globale** (`CERTIFICATION_PRIVATE_KEY`, variable d'environnement en clair) signe **toutes** les organisations de la plateforme — la classe s'appelle explicitement `StubEd25519CertificationService` avec deux `TODO` déjà écrits dans le code : *"Cert-Engine Rust — stub de bootstrap en Node"* et *"HSM cloud en production, jamais la clé en variable d'environnement"*. Ni identité par organisation, ni HSM, ni délégation par canal, ni révocation n'existent.

**Contrainte de rétrocompatibilité — le point le plus important de ce plan.** Ce repo contient déjà des dizaines de factures réellement certifiées (E2E de toute la session) signées avec la clé globale actuelle. Un système de confiance ne peut **jamais** invalider rétroactivement une certification déjà émise en changeant simplement le mécanisme de signature — ce serait détruire la valeur même du produit ("preuve cryptographique immutable"). La conception doit donc **versionner** la clé signataire par facture, jamais migrer les anciennes factures vers un nouveau schéma de vérification.

## Décision d'architecture

**Nouveau modèle `OrganizationSigningKey`** (1 par organisation pour cette story — le schéma autorise structurellement plusieurs clés dans le temps, sans construire de rotation active ici) :
```
id, organizationId (FK, unique pour cette story), publicKey (hex, clair),
encryptedPrivateKey (AES-256-GCM : IV + ciphertext + tag), createdAt
```

**`Invoice.signingKeyId`** (nouveau, FK nullable vers `OrganizationSigningKey`) — **`null` = signée avec l'ancienne clé globale légataire** (toutes les factures existantes, jamais touchées, jamais re-vérifiées différemment). **Non-null = signée avec la clé racine de son organisation** (toute nouvelle facture après cette story).

**Chiffrement au repos ("HSM cloud" — approximation MVP honnête, même posture que `CERTIFICATION_PRIVATE_KEY` déjà en place)** : nouveau secret `CERTIFICATION_MASTER_KEY` (AES-256-GCM, 32 octets, variable d'environnement — **strictement distinct** de tous les autres secrets déjà présents dans ce repo) chiffre la clé privée Ed25519 de chaque organisation avant persistance. Déchiffrement uniquement en mémoire au moment de signer, jamais journalisé, jamais persisté en clair. C'est un chiffrement enveloppe (envelope encryption) — le même principe qu'un vrai HSM/KMS cloud, sans le matériel dédié (aucun SDK Vault/AWS KMS/GCP KMS n'existe dans ce repo — construire une vraie intégration HSM serait disproportionné et non vérifiable en environnement de dev local).

**Provisionnement** : à la création de l'organisation, dans la même transaction — **les 3 chemins de création** (`create()`, `createAssisted()`, `createFromApip()`) génèrent chacun une paire de clés et persistent la clé racine. Les organisations déjà existantes en base (créées avant cette story) reçoivent une clé via un script de backfill exécuté une fois (génération de clé réelle + chiffrement, donc un script Node/TS exécuté manuellement — pas une simple migration SQL, qui ne peut pas générer de matériel cryptographique).

**`issue()`** (émission d'une facture) : au lieu d'utiliser le service de certification global injecté, récupère la clé racine de l'organisation, la déchiffre, construit une instance de signature avec cette clé précise, signe, et persiste `signingKeyId` pointant vers cette clé.

**`GET /verify/:certificationId`** : branche selon `invoice.signingKeyId`. `null` → chemin legacy inchangé (clé globale, comportement identique à aujourd'hui). Non-null → récupère + déchiffre la clé de l'organisation correspondante, revérifie avec celle-ci. Le chaînage (`previousHash`) reste inchangé — il est déjà scopé par organisation et **indépendant** du mécanisme de signature (une chaîne peut légitimement transitionner d'une facture signée-legacy à une facture signée-par-clé-propre sans casser l'intégrité du chaînage lui-même).

## Alternatives écartées

**Migrer toutes les anciennes factures vers un nouveau système de vérification** — écartée catégoriquement, invaliderait rétroactivement des certifications déjà légitimement émises (voir contrainte de rétrocompatibilité ci-dessus).

**Vraie intégration HSM/KMS cloud (Vault, AWS KMS)** — écartée pour cette story, aucun SDK ni compte cloud disponible dans cet environnement de dev ; chiffrement enveloppe local est l'approximation honnête déjà pratiquée pour tous les autres secrets de ce repo (documentée comme telle, pas cachée).

**Délégation de clé par canal (ADR-026, 2ᵉ moitié de la décision)** — écartée de cette story, périmètre distinct et plus complexe (certificats de délégation, révocation par canal) ; A3 se limite à la clé racine elle-même.

**A4 (registre émetteur public, vérification à la date d'émission)** — écartée de cette story, dépend d'un registre de clés qui n'existe qu'APRÈS cette story ; devient une story naturelle de suivi, pas construite ici.

**Rotation de clé active (endpoint pour émettre une 2ᵉ clé)** — écartée, le schéma l'autorise structurellement (FK, pas de clé inline sur `Invoice`) mais aucun mécanisme n'est construit maintenant — aucun signal backlog pour ça dans A3.

## Risque d'implémentation principal — à anticiper explicitement

`InvoicesService.issue()` ne peut plus recevoir le service de certification comme un singleton global injecté tel quel — il a besoin de résoudre la clé PAR ORGANISATION. Ceci change la forme du constructeur de `InvoicesService` (ou introduit un nouveau collaborateur en paramètre additionnel). `invoices.service.spec.ts` est le plus gros fichier de test de ce repo (~60 tests) et instancie `new InvoicesService(prisma, numbering, certification, paymentLinkClient)` dans la quasi-totalité de ses tests — un changement de signature de constructeur a un rayon d'impact large et mérite une cartographie précise avant le premier test RED, exactement comme fait pour la grille de commission (C6) en son temps. C'est la raison pour laquelle ce plan doit passer par `dev-architect` avant tout code — pas `dev-tdd-enforcer` directement.

## Découpage en tâches bite-sized (pour la phase d'implémentation, une fois validée)
- [ ] Tâche 1 : `schema.prisma` — `OrganizationSigningKey`, `Invoice.signingKeyId` nullable, migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/certification/organization-signing-key.service.ts` — chiffrement/déchiffrement enveloppe (AES-256-GCM), `provisionRootKey(organizationId)`, `certifyForOrganization(organizationId, payload)`
- [ ] Tâche 3 : script de backfill (une exécution manuelle) pour les organisations déjà existantes
- [ ] Tâche 4 : `organizations.service.ts` — provisionnement dans les 3 chemins de création (même transaction)
- [ ] Tâche 5 : `invoices.service.ts:issue()` — bascule vers la clé de l'organisation, persiste `signingKeyId`
- [ ] Tâche 6 : `verification.service.ts` — branche `signingKeyId` null/non-null
- [ ] Tâche 7 : `.env.example` — `CERTIFICATION_MASTER_KEY`
- [ ] Tâche 8 : mise à jour exhaustive des fixtures `invoices.service.spec.ts` (cartographie précise déléguée à `dev-architect`)

## Critères de done
- Toutes les factures déjà en base restent vérifiables à l'identique (test de non-régression explicite : recertifier une ancienne facture ne change ni son `hash` ni son `signature`)
- Toute nouvelle facture est signée avec la clé propre de son organisation, jamais la clé globale
- Aucune clé privée en clair en base, en log, ou dans une réponse HTTP
- Suite complète verte, code-reviewer OK
- **security-reviewer obligatoire** — nouvelle catégorie de secret la plus sensible de ce repo
- **domain-model-reviewer recommandé** — nouveau modèle portant un secret cryptographique

## Risques identifiés & mitigations
- Risque 1 (détaillé ci-dessus) : rayon d'impact large sur `invoices.service.spec.ts` → mitigation : cartographie précise par `dev-architect` avant le premier test.
- Risque 2 : `CERTIFICATION_MASTER_KEY` absent ou perdu rendrait TOUTES les clés d'organisation indéchiffrables (perte totale de la capacité de signature de la plateforme) → mitigation : même posture fail-fast déjà en place pour les autres secrets (`JWT_PRIVATE_KEY`, `CERTIFICATION_PRIVATE_KEY`) — le processus refuse de démarrer sans lui, jamais une dégradation silencieuse.
- Risque 3 : génération de clé Ed25519 lors de la création d'une organisation ajoute une opération cryptographique dans le chemin critique de `create()`/`createAssisted()`/`createFromApip()` — coût négligeable (génération Ed25519 : microsecondes), pas un risque de performance réel.
