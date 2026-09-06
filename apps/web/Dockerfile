# Lot G — image de production web (Next.js 16, `next start`).
#
# `output: standalone` a été écarté : sur le monorepo la trace NFT du middleware
# échoue de façon non déterministe (fichier .nft.json manquant en fin de build,
# reproduit sous Windows). On sert donc via `next start` avec le build .next
# complet. Slimming reporté (même raison que trust-api / money-api).
#
# Build depuis la RACINE du monorepo :
#   docker build -f apps/web/Dockerfile -t facture-gn/web .
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
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
COPY apps/web ./apps/web
COPY packages/db ./packages/db
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @facture-gn/web run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo/apps/web
COPY --from=build --chown=node:node /repo/node_modules /repo/node_modules
COPY --from=build --chown=node:node /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/
COPY --from=build --chown=node:node /repo/apps/web/package.json /repo/apps/web/next.config.ts ./
COPY --from=build --chown=node:node /repo/apps/web/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/web/.next ./.next
COPY --from=build --chown=node:node /repo/apps/web/public ./public
USER node
EXPOSE 3002
ENV PORT=3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/next", "start"]
