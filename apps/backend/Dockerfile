FROM node:20-alpine AS base
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/api ./packages/api
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

RUN pnpm -C apps/backend build --noEmitOnError false

ENV NODE_ENV=production
WORKDIR /app/apps/backend
EXPOSE 8787
USER node

CMD ["node", "dist/index.js"]
