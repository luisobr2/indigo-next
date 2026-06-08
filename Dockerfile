# syntax=docker/dockerfile:1.7

# Multi-stage Dockerfile for the Indigo Decors operational panel (Next.js 16).
# Stage 1: install deps (cached on package-lock.json).
# Stage 2: build with `next build` (produces .next/standalone).
# Stage 3: minimal runtime image with just node + the standalone bundle.

FROM node:22-alpine AS deps
WORKDIR /app
# libc6-compat fixes the occasional `Error: could not load wasm` we hit on
# Next 16 + Turbopack against alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# Use `npm install` (not `npm ci`) because the lockfile has nested
# duplicates that older npm in the build image refuses to validate. We
# still get reproducibility from the committed lockfile.
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

# Non-root user so the container doesn't run as root even if Coolify
# forgets to drop privileges.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

# Only the runtime artifacts. server.js is the standalone entry point that
# Next.js produces; it embeds the minimal node_modules it needs.
COPY --from=builder --chown=nextjs:nodejs /app/public            ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs

EXPOSE 4000

# Healthcheck pings the login route — it's static + cheap and exists as
# soon as the server is up (no DB/Odoo dependency).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/login" >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
