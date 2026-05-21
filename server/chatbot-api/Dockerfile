# Railway: set container RAM in the dashboard; override heap with NODE_OPTIONS if needed.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_jobs=1
ENV npm_config_maxsockets=2
ENV npm_config_fetch_retries=2
# Cap Node heap during npm ci (build container may be smaller than runtime).
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
# Latest yt-dlp + ffmpeg for YouTube → WhatsApp native video.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*
# Default ~4GB heap when the service has 8GB RAM. Override in Railway Variables if needed.
ENV NODE_OPTIONS=--max-old-space-size=4096
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
