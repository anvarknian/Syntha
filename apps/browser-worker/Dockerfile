FROM node:26-bookworm

WORKDIR /app
COPY apps/browser-worker/package*.json ./
RUN npm ci --no-audit --no-fund
RUN npx playwright install --with-deps chromium

COPY apps/browser-worker/ ./
COPY services /services

ENV NODE_ENV=production
ENTRYPOINT ["npm", "run", "start"]
