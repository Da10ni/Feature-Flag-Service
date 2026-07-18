# Stage 1: Build — carries the full toolchain and devDependencies, none of which ship.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
WORKDIR /app

# --omit=dev rather than the deprecated --only=production. Cleaning the npm cache in the
# SAME layer matters: a separate RUN would leave the cache baked into the layer beneath it.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# No `RUN chown -R /app`. chown rewrites metadata on every file, which makes Docker
# materialise a second full copy of node_modules as a new layer — 130MB of pure duplication
# in an image whose dependencies are only 130MB to begin with. The app never writes to /app,
# and root-owned files are world-readable, so the unprivileged user can already read them.
USER nestjs

EXPOSE 3000

# Container-level liveness. /api/v1/health returns 503 when Postgres is unreachable, so this
# reports unhealthy on a broken dependency rather than merely on a dead process.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
