# Lot G — image de production money-api (monorepo pnpm). Multi-stage :
#  deps   : install des dépendances (couche cachée tant que les lockfiles ne bougent pas)
#  build  : prisma generate + build de packages/db puis de l'app
#  runner : node:20-slim + l'arbre construit, non-root
#
# Slimming reporté (pnpm deploy avec inject-workspace-packages, ou prune --prod) :
# les deux cassent la réhydratation du client Prisma généré dans le store pnpm,
# et cela ne peut être validé sans démon Docker local. L'image embarque donc
# node_modules complet ; la réduction de taille est un chantier Vague 2+.
#
# Build depuis la RACINE du monorepo :
#   docker build -f apps/money-api/Dockerfile -t facture-gn/money-api .
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
# openssl : requis par les moteurs Prisma sur debian-slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS deps
# argon2 (dép runtime de trust-api, `allowBuilds` dans pnpm-workspace.yaml) : le
# `pnpm install` du workspace complet exécute son script d'install, qui retombe
# sur `node-gyp` quand le prebuild N-API n'est pas résolu sur linux-x64 → il faut
# la toolchain C. Confinée aux stages deps/build : le runner dérive de `base`.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Tous les manifestes du workspace : `pnpm install --frozen-lockfile` compare les
# importers du lockfile aux paquets trouvés — un manifeste manquant le fait échouer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY apps/trust-api/package.json ./apps/trust-api/
COPY apps/money-api/package.json ./apps/money-api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/db ./packages/db
COPY apps/money-api ./apps/money-api
RUN pnpm --filter @facture-gn/db exec prisma generate \
 && pnpm --filter @facture-gn/db run build \
 && pnpm --filter @facture-gn/money-api run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=build --chown=node:node /repo/packages/db ./packages/db
COPY --from=build --chown=node:node /repo/apps/money-api/package.json ./apps/money-api/
COPY --from=build --chown=node:node /repo/apps/money-api/node_modules ./apps/money-api/node_modules
COPY --from=build --chown=node:node /repo/apps/money-api/dist ./apps/money-api/dist
WORKDIR /repo/apps/money-api
USER node
EXPOSE 3001
ENV PORT=3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
