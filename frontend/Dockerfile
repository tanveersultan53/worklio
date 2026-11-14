# Production image: Next.js standalone server. NEXT_PUBLIC_* are baked in at build time.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 10001 worklio && adduser -S -u 10001 -G worklio worklio
COPY --from=build --chown=worklio:worklio /app/.next/standalone ./
COPY --from=build --chown=worklio:worklio /app/.next/static ./.next/static
COPY --from=build --chown=worklio:worklio /app/public ./public
USER worklio
EXPOSE 3000
CMD ["node", "server.js"]
