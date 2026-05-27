FROM node:26-bookworm-slim

WORKDIR /app
COPY apps/fake-slack/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY apps/fake-slack/ ./
COPY services /services

ENV NODE_ENV=production
EXPOSE 3002
ENTRYPOINT ["npm", "start"]
