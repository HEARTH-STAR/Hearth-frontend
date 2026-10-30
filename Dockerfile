FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATABASE_PATH=/data/hearth.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
# The server applies these at start (src/server/db/index.ts), before it listens.
COPY --from=build /app/drizzle ./drizzle
USER node
EXPOSE 4310
CMD ["node", "dist/server/server/index.js"]
