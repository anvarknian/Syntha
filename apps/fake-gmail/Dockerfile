FROM node:26-bookworm-slim

WORKDIR /app
COPY apps/fake-gmail/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY apps/fake-gmail/ ./
COPY services /services

ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["npm", "start"]
