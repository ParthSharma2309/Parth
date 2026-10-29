# Stage 1: Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy application source code
COPY . .

# Build frontend production bundle (Vite SPA)
RUN npm run build

# Stage 2: Production Runner Stage
FROM node:22-alpine AS runner

WORKDIR /app

# Install curl for container health check
RUN apk add --no-cache curl

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Copy package manifests and install production-only dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend dist and server source from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/config ./src/config

# Ensure node non-root user owns the working directory
RUN chown -R node:node /app

# Switch to unprivileged non-root user
USER node

# Expose HTTP port
EXPOSE 3000

# Container healthcheck targeting /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/api/health || exit 1

# Start DocuMind server
CMD ["node", "server.ts"]
