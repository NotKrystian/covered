# syntax=docker/dockerfile:1
# Covered — Next.js 16 standalone server + Playwright Chromium.
#
# Platform is picked at build time, not here: deploy/aws/redeploy.sh builds
# linux/arm64 for the Graviton box (natively on the instance, or locally with
# `docker buildx build --platform linux/arm64`).
#
#   docker buildx build --platform linux/arm64 -t covered .
#   docker run --rm -p 3000:3000 --shm-size=1g -e AWS_REGION=eu-west-2 covered
#
# The runtime stage is Microsoft's Playwright image so Chromium and all of its
# shared-library deps exist for src/lib/reader. The tag MUST match the
# `playwright` version in package.json (1.63.0) or the driver will not find its
# browsers. For a browser-less image (e.g. App Runner with
# COVERED_READER_DISABLED=1) override the base: --build-arg RUNTIME_IMAGE=node:22-slim

ARG NODE_IMAGE=node:22-bookworm-slim
ARG RUNTIME_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble

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
FROM ${RUNTIME_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NEXT_TELEMETRY_DISABLED=1

# Non-root. No fixed uid/gid: the Playwright image already uses 1000/1001.
# /ms-playwright is world-readable there, so this user can launch Chromium.
RUN useradd --system --user-group --create-home --home-dir /home/covered covered

# server.js + traced node_modules, then the assets server.js does not copy itself.
COPY --from=build --chown=covered:covered /app/.next/standalone ./
COPY --from=build --chown=covered:covered /app/.next/static ./.next/static
COPY --from=build --chown=covered:covered /app/public ./public

# Playwright's persistent headless profile lives under os.tmpdir(); /tmp is writable.
USER covered
EXPOSE 3000
CMD ["node", "server.js"]
