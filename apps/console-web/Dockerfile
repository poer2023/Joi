FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next /app/.next
COPY --from=build /app/next.config.mjs /app/next.config.mjs

EXPOSE 3000
CMD ["npm", "run", "start"]
