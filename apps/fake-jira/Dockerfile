FROM node:20-bookworm-slim

WORKDIR /app
COPY apps/fake-jira/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY apps/fake-jira/ ./
COPY services /services

ENV NODE_ENV=production
EXPOSE 3003
ENTRYPOINT ["npm", "start"]
