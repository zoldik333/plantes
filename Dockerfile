# Debian (glibc) : le binaire natif Claude Code fourni par l'Agent SDK en a besoin.
# Deux étapes : la première construit le front (Vite, Tailwind…), la seconde ne garde que ce qui sert à l'exécution
# (aucun outil de développement dans l'image finale).

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# tests/ fait partie du workspace (le lockfile le mentionne) mais n'est installé nulle part dans l'image.
COPY tests/package.json tests/
RUN pnpm install --frozen-lockfile --filter @plantes/web...
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @plantes/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    AI_WORKDIR=/tmp/plantes-ai
RUN corepack enable
WORKDIR /app

# Dépendances d'abord (couche mise en cache tant que les package.json et le lockfile ne changent pas).
# --prod : sans les dépendances de développement. tsx (qui exécute le TypeScript du serveur) est une dépendance de production.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY tests/package.json tests/
RUN pnpm install --frozen-lockfile --prod --filter @plantes/api... && pnpm store prune

COPY apps/api apps/api
COPY packages/shared packages/shared
# Le front construit est servi par l'API (même origine : cookies et passkeys).
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /app/data && chown -R node:node /app
USER node

WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
