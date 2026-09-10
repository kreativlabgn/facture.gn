# CLAUDE.md — facture.gn

Guide de travail pour Claude Code sur ce dépôt. Complète — ne remplace pas —
[`README.md`](README.md) (démarrage, env, observabilité) et
[`CONTRIBUTING.md`](CONTRIBUTING.md) (workflow TDD imposé, conventions de commit,
pièges Prisma/ESLint connus). En cas de contradiction, `CONTRIBUTING.md` fait foi
sur le process.

## Ce qu'est le dépôt

Infrastructure de facturation certifiée pour les PME de Guinée — monorepo pnpm
workspaces + Turborepo. Trois couches produit : **Trust** (certification
cryptographique Ed25519 / chaînage SHA-256), **Money** (orchestrateur de paiement
Djomy → Moneroo), **Capital** (financement, V2, non scaffoldé).

Positionnement non négociable : **tiers de confiance privé certifié, jamais un
registre ni une autorité d'État**. Ne jamais écrire « officiel », « République de
Guinée » comme label, ni suggérer un sceau / tampon administratif dans le code,
l'UI ou les libellés.

Documentation métier de référence (PRD, DAT, ERD, Registre ADR, Charte Graphique,
Maquette) : dossier `../V/` s'il existe localement, sinon le dossier de
sauvegarde `Desktop/facture.gn.docs-backup-*`. Le code va jusqu'à ~ADR-118 ; le
Registre ADR sauvegardé s'arrête plus tôt — le code fait foi.

---

## Charte graphique — choix verrouillés (Charte v1.3)

L'implémentation suit **la Charte Graphique & Design System v1.3**, pas la
maquette HTML (`Maquette-facture-gn.html`) : celle-ci était un prototype
(essais Space Grotesk / `#FBB500` des ADR-102-103) — **abandonnée**. Source de
vérité en code : `apps/web/src/app/globals.css` + `apps/web/src/app/layout.tsx`.

### Couleurs

| Rôle | Hex | Token Tailwind | Usage |
|---|---|---|---|
| Navy (Nuit Atlantique) | `#0B1D3A` | `navy-950` (+ `-800/-700/-600/-400/-200/-100/-50` en opacités) | Texte, titres, structure — ~60 % |
| Jaune (Jaune Fatoora) | `#F2B705` | `yellow` | Dot du logo, badges #FG, CTA, accents — ~30 %. **Jamais `#FBB500`.** |
| Light Gray | `#F5F7F9` | `grey` | Fond de page — ~10 % |
| Blanc | `#FFFFFF` | `white` | Fond des cartes |

Couleurs **sémantiques UI uniquement** — jamais décoratives, jamais couleur de
marque. Chacune a un fond teinté 12 % + un texte assombri (le ton brut de la
charte échoue WCAG AA sur son propre fond teinté) :

| Rôle | Base | Paire de classes |
|---|---|---|
| Succès | `#16A34A` | `bg-green-bg text-green-text` |
| Alerte / attente | `#D97706` | `bg-amber-bg text-amber-text` |
| Info / partiel | `#2563EB` | `bg-blue-bg text-blue-text` |
| Erreur / litige | `#DC2626` | `bg-red-bg text-red-text` |
| Neutre / brouillon | — | `bg-navy-50 text-navy-400` |

Jamais rouge **et** vert ensemble dans un contexte de marque (confusion drapeau
guinéen). Jamais de couleurs du drapeau (rouge/vert) dans l'identité.

### Typographie (chargée via `next/font/google` dans `layout.tsx`)

| Famille | Token | Poids chargés | Usage exclusif |
|---|---|---|---|
| **Poppins** | `font-display` | 600, 700, 800 | Marque, titres, boutons. Jamais < 12 px (en dessous → Inter). |
| **Inter** | `font-sans` (défaut) | 400, 600 | Texte courant, labels, formulaires |
| **JetBrains Mono** | `font-mono` | 700 uniquement | Identifiants **déjà certifiés** : certification_id, montants figés, hash, timestamps. Jamais la saisie utilisateur. |

Ne jamais élargir la gamme de poids « au cas où » : chaque poids = un aller-retour
réseau de plus sur mobile guinéen. La charte ne définit qu'un seul poids mono.

### Règles de marque (Charte R-01 → R-15) — les plus structurantes

- Wordmark toujours en **lowercase**, jamais d'uppercase même partiel.
- Le **dot jaune EST la ponctuation** entre `facture` et `gn` — jamais un `.`
  littéral. Voir `apps/web/src/components/Wordmark.tsx` (composant unique).
- Aucun dégradé, nulle part (logo, UI, print).
- Pas de jaune sur fond blanc sans contour navy 1 px ; jamais de texte blanc sur
  jaune (contraste insuffisant).
- Toute facture porte un QR de vérification ; tout certificat porte le triple
  badge crypto (`SIGNÉ · ED25519` / `HORODATÉ · SHA-256` / `VÉRIFIABLE · *620#`).
- `viewport.themeColor` = `#0b1d3a`.

### Tailwind

Tailwind v4, config inline via `@theme inline { … }` dans `globals.css` (pas de
`tailwind.config.js`). Ajouter une couleur = ajouter la variable CSS dans `:root`
**et** la remapper dans `@theme inline`. Rester sur les tokens existants avant
d'en créer.

---

## Structure du monorepo

```
apps/
  trust-api/   @facture-gn/trust-api   NestJS · Trust Context — IAM, orgs multi-tenant,
                                       facturation core, certification, vérif publique,
                                       USSD, portail client, B2G, cabinet/CGA, FEC.
                                       Port 3000. Cert-Engine = stub Node (@noble/*).
  money-api/   @facture-gn/money-api   NestJS · Money Context — orchestrateur PaymentProvider,
                                       circuit breaker Djomy→Moneroo, webhooks idempotents,
                                       worker de réconciliation BullMQ. Port 3001.
  web/         @facture-gn/web         Next.js 14 (App Router, PWA/Serwist) — dashboard PME,
                                       page paiement publique, page vérification publique
                                       /[certificationId], portail client, vue cabinet.
packages/
  db/          @facture-gn/db          Schéma Prisma partagé (Postgres 16), client généré,
                                       migrations ÉCRITES À LA MAIN. Expose dist/ compilé.
docs/
  plans/       Un plan daté par feature (gabarit imposé, cf. CONTRIBUTING.md §1).
  architecture/  ADR d'archi (adr-e1..e5), diagrammes C4.
  runbooks/ · compliance/ · contracts/ · slo.md
docker-compose.yml   Postgres 16 + Redis 7 (défaut) ; profil `full` = + les 3 apps buildées.
```

Capital Context et Platform Context ne sont pas encore scaffoldés.

**Frontières inter-services** : `web` ne parle qu'à `trust-api` (fetch server-only,
jamais `NEXT_PUBLIC_`). `money-api` ↔ `trust-api` via secrets partagés strictement
distincts (voir les `.env.example`). Le navigateur ne voit jamais une URL d'API.

---

## Commandes — pnpm 11 + Turborepo

Le filtre pnpm accepte le **nom court** (basename du dossier) : `web`, `trust-api`,
`money-api`, `db` — ou le nom complet `@facture-gn/<x>`. Les deux marchent.

### Installation & base de données

```bash
pnpm install                              # frozen-lockfile en CI
docker compose up -d                      # Postgres 16 + Redis 7 en local

pnpm --filter db db:generate              # génère le client Prisma
pnpm --filter db db:migrate               # applique les migrations (dev)
pnpm --filter db build                    # OBLIGATOIRE après db:generate — db expose dist/,
                                          # l'oublier casse le typecheck de trust-api avec
                                          # un message trompeur (« no exported member »)
pnpm --filter db db:migrate:deploy        # migrations en mode CI/prod (pas de prompt)
```

Après **tout** changement de `packages/db/prisma/schema.prisma` :
`db:generate` **puis** `db build`, dans cet ordre.

### Développement

```bash
pnpm --filter web dev                     # Next.js — http://localhost:3000
pnpm --filter trust-api dev               # NestJS watch — :3000
pnpm --filter money-api dev               # NestJS watch — :3001
pnpm turbo dev                            # tout en watch (turbo.json : persistent, non caché)
```

⚠️ `web` et `trust-api` écoutent tous deux le port **3000** par défaut. Pour les
lancer ensemble, forcer le port du web : `PORT=3002 pnpm --filter web dev`
(ou `pnpm --filter web dev -- --port 3002`), en cohérence avec `docker-compose.yml`
(web = 3002).

⚠️ NestJS ne charge pas `.env` tout seul — exporter les variables ou passer par
`dotenv -e .env -- pnpm --filter trust-api dev`. Un secret manquant fait
échouer le démarrage (fail-fast voulu).

### Qualité — exactement ce que la CI exige (toutes bloquantes)

```bash
pnpm turbo lint                           # ESLint type-checked, règles strictes (eslint.config.js)
pnpm turbo typecheck                      # tsc --noEmit (+ next typegen + tsconfig.sw.json pour web)
pnpm turbo test                           # vitest ; gate de COUVERTURE sur trust-api & money-api
pnpm turbo build                          # next build --webpack (Serwist ≠ Turbopack) ; nest build
pnpm turbo lint typecheck test            # la passe complète — à relancer après CHAQUE merge,
                                          # même sans conflit affiché (cf. CONTRIBUTING.md §7)
```

Cibler un seul paquet : `pnpm --filter trust-api test`,
`pnpm --filter web typecheck`, etc. Un seul test :
`pnpm --filter trust-api exec vitest run chemin/du.spec.ts`.

Sécurité (jobs CI séparés) : `pnpm exec audit-ci --config .audit-ci.jsonc` ;
gitleaks scanne l'historique git. CodeQL en plus.

### Observabilité locale

`GET /health/live` · `/health/ready` · `/metrics` (Prometheus) sur chaque API —
**non authentifiés, réseau interne uniquement**, jamais exposés via l'ingress.

---

## Rappels de workflow (détail : CONTRIBUTING.md)

- **Aucun commit direct sur `master`.** `master` est de toute façon en retard —
  le travail vit sur des branches `feat/…` `fix/…` `refactor/…` `chore/…`.
- Toute évolution non triviale (> ~5 lignes) : plan daté dans `docs/plans/`
  **avant** le code, puis **TDD strict** (RED → GREEN → REFACTOR), puis revues
  parallèles, puis merge `--no-ff`.
- Pour tout correctif touchant **auth / autorisation** : répéter les passes de
  revue jusqu'à un « solide » explicite, jamais s'arrêter à « rien trouvé ».
- Commit : `type(scope): résumé (Story ID / §ADR)` — le scope nomme les paquets
  touchés ; un `feat` sans `test` est suspect. Terminer par les lignes de
  co-autorat de la session.
- **Migrations écrites à la main** — suivre le format de
  `packages/db/prisma/migrations/`, ne pas compter sur `prisma migrate dev`
  contre une vraie DB.
- Ne jamais loguer un enregistrement Prisma entier ni un montant GNF / PIN / NIF /
  secret en clair.
