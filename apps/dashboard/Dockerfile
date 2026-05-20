FROM node:20-bookworm-slim

WORKDIR /app
COPY apps/dashboard/package*.json ./
RUN npm ci --no-audit --no-fund

COPY apps/dashboard/ ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

EXPOSE 3000
ENTRYPOINT ["npm", "start"]
