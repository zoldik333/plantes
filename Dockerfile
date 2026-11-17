# Debian (glibc) : le binaire natif Claude Code fourni par l'Agent SDK en a besoin.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    AI_WORKDIR=/tmp/plantes-ai

RUN corepack enable
WORKDIR /app

# Dépendances d'abord (couche mise en cache tant que les package.json et le lockfile ne changent pas).
# --prod=false : tsx (devDependency) lance le TypeScript directement, suffisant pour l'instant.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod=false && pnpm store prune

COPY apps/api apps/api
COPY packages/shared packages/shared

RUN mkdir -p /app/data && chown -R node:node /app
USER node

WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
