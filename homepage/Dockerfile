# Stage 1: Dependencies
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

# Stage 2: Builder
FROM node:20-slim AS builder
RUN apt-get update -qq && apt-get install -y -qq openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

# Stage 3: Runner
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update -qq && apt-get install -y -qq openssl netcat-openbsd && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
