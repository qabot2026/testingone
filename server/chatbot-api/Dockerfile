# Low-memory install: single job, no audit/fund, optional lockfile for npm ci.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_jobs=1
ENV npm_config_maxsockets=2
ENV npm_config_fetch_retries=2
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY index.mjs ./
COPY lib ./lib
COPY scripts ./scripts
COPY data ./data
COPY public ./public
COPY dashboard ./dashboard
COPY live-agent ./live-agent
EXPOSE 8080
CMD ["node", "index.mjs"]
