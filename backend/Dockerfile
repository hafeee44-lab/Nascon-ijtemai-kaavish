FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/web/player.css /app/src/web/player.js ./dist/web/
COPY --from=build /app/src/web/assets ./dist/web/assets
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/main.js"]
