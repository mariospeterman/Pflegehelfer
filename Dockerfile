FROM node:24.19.0-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm verify && pnpm prune --prod

FROM node:24.19.0-alpine
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0
WORKDIR /app
RUN addgroup -S pfh && adduser -S -G pfh -u 10001 pfh
COPY --from=build --chown=pfh:pfh /app/dist ./dist
COPY --from=build --chown=pfh:pfh /app/node_modules ./node_modules
COPY --from=build --chown=pfh:pfh /app/package.json ./package.json
COPY --from=build --chown=pfh:pfh /app/db ./db
USER 10001
EXPOSE 4173
CMD ["node", "dist/src/server/index.js"]
