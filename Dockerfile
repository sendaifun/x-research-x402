FROM oven/bun:1.3.1 AS deps
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lockb tsconfig.json ./
COPY ct-search.ts server.ts ./
COPY lib ./lib
COPY data ./data

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
