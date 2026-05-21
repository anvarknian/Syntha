FROM node:20-bookworm-slim

WORKDIR /app
COPY apps/fake-salesforce/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY apps/fake-salesforce/ ./
COPY services /services

ENV NODE_ENV=production
EXPOSE 3004
ENTRYPOINT ["npm", "start"]
