# Tuned for ~1GB Railway instances (build + runtime).
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_jobs=1
ENV npm_config_maxsockets=2
ENV npm_config_fetch_retries=2
# Cap Node heap during npm ci so install fits in 1GB builders.
ENV NODE_OPTIONS=--max-old-space-size=460
COPY package.json package-lock.json* .npmrc ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Leave ~250MB for native libs, buffers, and OS on a 1GB plan.
ENV NODE_OPTIONS=--max-old-space-size=768
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY index.mjs ./
COPY lib ./lib
COPY data ./data
COPY public ./public
COPY dashboard ./dashboard
COPY live-agent ./live-agent
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
