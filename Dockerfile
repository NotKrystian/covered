# syntax=docker/dockerfile:1
# Covered — Next.js 16 standalone server for AWS App Runner (linux/amd64).
#
#   docker buildx build --platform linux/amd64 -t covered .
#   docker run --rm -p 3000:3000 -e AWS_REGION=eu-west-2 -e COVERED_READER_DISABLED=1 \
#     -v ~/.aws:/home/covered/.aws:ro covered          # ~/.aws mount is for local testing only
#
# No Playwright browsers are installed: Google blocks datacenter IPs, so the
# service runs with COVERED_READER_DISABLED=1 and the reader falls back to the
# snapshots in public/snapshots. The `playwright` npm package is still present
# (it is a dependency of the reader) but never launches a browser here.

ARG NODE_IMAGE=node:22-slim

# ---- build ------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CI=1
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 covered \
 && useradd --system --uid 1001 --gid covered --create-home --home-dir /home/covered covered

# server.js + traced node_modules, then the assets server.js does not copy itself.
COPY --from=build --chown=covered:covered /app/.next/standalone ./
COPY --from=build --chown=covered:covered /app/.next/static ./.next/static
COPY --from=build --chown=covered:covered /app/public ./public

USER covered
EXPOSE 3000
CMD ["node", "server.js"]
