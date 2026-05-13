FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
COPY lib ./lib
COPY scripts ./scripts
COPY data ./data
COPY public ./public
ENV NODE_ENV=production
# Railway injects PORT; 8080 is the default for local Docker.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.mjs"]
