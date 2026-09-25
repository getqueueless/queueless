# Build context: repo root (supabase/.env is never copied).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS prune
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps apps
COPY packages packages
RUN pnpm dlx turbo@2.11.4 prune web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build && pnpm prune --prod

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# ponytail: no output:'standalone' in apps/web/next.config.ts, so ship node_modules + next start (bigger image)
COPY --from=build --chown=node:node /app .
USER node
EXPOSE 3000
WORKDIR /app/apps/web
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "/app/node_modules/next/dist/bin/next", "start"]
