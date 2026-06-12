# syntax=docker/dockerfile:1

FROM node:22 AS web-build
WORKDIR /app/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM node:22 AS server-build
WORKDIR /app/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci
COPY apps/server/ ./
RUN npx tsc
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data && chown 1000:1000 /data
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=web-build /app/web/dist ./web
ENV TORMOD_WEB_DIST=/app/web
ENV TORMOD_AUDIT=/data/tormod.db
ENV HOST=0.0.0.0
ENV PORT=8790
USER node
EXPOSE 8790
CMD ["node", "dist/server.js"]
