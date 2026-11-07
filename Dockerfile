FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Use the supported webpack builder; Turbopack can reject Google font URLs.
RUN npm run build -- --webpack

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["sh", "scripts/docker-entrypoint.sh"]
