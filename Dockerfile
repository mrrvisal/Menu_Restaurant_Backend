# syntax=docker/dockerfile:1

# --- Base image ---
FROM node:20-alpine AS base
WORKDIR /app

# --- Install deps (cached) ---
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --- Build/runtime image ---
FROM base AS runner
# Copy dependencies and application
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure runtime directories exist
RUN mkdir -p /app/uploads

ENV NODE_ENV=production
EXPOSE 5001

CMD ["node", "server.js"]

