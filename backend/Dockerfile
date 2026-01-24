# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules (argon2, libsodium) and ffmpeg for video thumbnails
RUN apk add --no-cache libstdc++ ffmpeg

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S homemanager -u 1001 -G nodejs

# Copy built application
COPY --from=builder --chown=homemanager:nodejs /app/dist ./dist
COPY --from=builder --chown=homemanager:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=homemanager:nodejs /app/package.json ./
COPY --from=builder --chown=homemanager:nodejs /app/drizzle ./drizzle

# Copy entrypoint script
COPY --chown=homemanager:nodejs deploy/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create directories for storage and logs
RUN mkdir -p /data/storage /data/logs && \
    chown -R homemanager:nodejs /data

# Set environment variables
ENV NODE_ENV=production
ENV STORAGE_PATH=/data/storage
ENV LOG_PATH=/data/logs

# Switch to non-root user
USER homemanager

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
ENTRYPOINT ["docker-entrypoint.sh"]
