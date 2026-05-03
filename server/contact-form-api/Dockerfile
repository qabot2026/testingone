FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
COPY lib ./lib
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.mjs"]
