# Debian (glibc) : le binaire natif Claude Code fourni par l'Agent SDK en a besoin.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    AI_WORKDIR=/tmp/plantes-ai

WORKDIR /app
COPY package*.json ./
# --include=optional : le binaire Claude Code est une dépendance optionnelle de l'Agent SDK.
# --include=dev : tsx sert à lancer le TypeScript directement (suffisant pour un POC).
RUN npm install --include=optional --include=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server.ts"]
