# Railway: set container RAM in the dashboard; override heap with NODE_OPTIONS if needed.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_jobs=1
ENV npm_config_maxsockets=2
ENV npm_config_fetch_retries=2
# Cap Node heap during npm ci (build container may be smaller than runtime).
ENV NODE_OPTIONS=--max-old-space-size=460
COPY server/chatbot-api/package.json server/chatbot-api/package-lock.json* server/chatbot-api/.npmrc ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Default ~4GB heap when the service has 8GB RAM. Override in Railway Variables if needed.
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY --from=deps /app/node_modules ./node_modules
COPY server/chatbot-api/package.json ./
COPY server/chatbot-api/index.mjs ./
COPY server/chatbot-api/lib ./lib
COPY server/chatbot-api/data ./data
COPY server/chatbot-api/public ./public
COPY server/chatbot-api/dashboard ./dashboard
COPY server/chatbot-api/live-agent ./live-agent
COPY api-base.config.js ./api-base.config.js
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
