FROM node:20-slim

# app.js uses `ps -ef` for its keepalive process checks; the slim image lacks procps
RUN apt-get update \
 && apt-get install -y --no-install-recommends procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "app.js"]
