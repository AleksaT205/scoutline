# Jedan Dockerfile za api i worker: docker build --build-arg APP=api .
FROM node:20-alpine AS build
ARG APP
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @radar/${APP} build

FROM node:20-alpine
ARG APP
WORKDIR /app
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations
COPY --from=build /repo/apps/${APP}/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
CMD ["node", "dist/index.js"]
