# ==== Stage 1: Build (builder) ====
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package configs and install deps (leverages Docker layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ==== Stage 2: Runtime (runner) ====
FROM node:22-alpine AS runner

WORKDIR /app

# Production environment
ENV NODE_ENV=production

# Increase heap to avoid OOM when loading large logs (tesseract/js-tiktoken need memory too)
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Non-root user for safety
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 cursor

# Copy package configs and install prod deps only (smaller image)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

# Copy compiled artifacts from builder
COPY --from=builder --chown=cursor:nodejs /app/dist ./dist

# Copy static assets (log viewer UI)
COPY --chown=cursor:nodejs public ./public

# Create log directory and set ownership
RUN mkdir -p /app/logs && chown cursor:nodejs /app/logs

# Note: config.yaml is not baked in; mount via docker-compose volume.
# Without a mount, defaults + env vars are used.

# Switch to non-root user
USER cursor

# Expose port and log volume
EXPOSE 3010
VOLUME ["/app/logs"]

# Start service
CMD ["npm", "start"]
