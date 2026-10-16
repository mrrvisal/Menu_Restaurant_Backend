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

# Ensure runtime directories exist and are writable by the unprivileged user
# (#20: never run the API as root inside the container)
RUN mkdir -p /app/uploads \
 && chown node:node /app /app/uploads

ENV NODE_ENV=production
EXPOSE 5001

USER node
CMD ["node", "server.js"]

