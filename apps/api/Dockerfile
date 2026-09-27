# syntax=docker/dockerfile:1
#
# Multi-stage build for @sp/api (NestJS 12 + Prisma 7 + pg-boss), run with
# PROCESS_ROLE=all (API + workers in one process).
#
# Build context MUST be the monorepo root (not apps/api), because @sp/api
# depends on the sibling workspace package @sp/contracts:
#   docker build -f apps/api/Dockerfile -t sp-api .
#
# Prisma 7 here uses @prisma/adapter-pg (driver adapters): query execution
# goes through the `pg` package plus a portable WASM query compiler bundled
# inside @prisma/client/runtime — there is NO native Rust query-engine binary
# to match to an OS/arch (schema.prisma has no `binaryTargets`, and none is
# needed). This is why the build stage and runtime stage can even use
# different base images without an engine mismatch, though we keep them
# identical (node:24-slim/Debian bookworm) for simplicity.

ARG NODE_VERSION=24

########################################
# Base: Node 24 + pinned pnpm via corepack
########################################
FROM node:${NODE_VERSION}-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

########################################
# Builder: install workspace deps, generate Prisma client, compile TS
########################################
FROM base AS builder

# Manifests first for layer caching. pnpm needs every workspace package.json
# present to resolve the workspace graph, even though --filter below only
# installs dependencies for @sp/api and its workspace dependency @sp/contracts
# (apps/mobile's own dependencies, e.g. Expo/React Native, are never installed).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/contracts/package.json packages/contracts/package.json
# Root package.json declares pnpm.patchedDependencies (expo-share-intent, a
# mobile-only dep). pnpm hashes the patch file up front for every install —
# even filtered ones that never touch mobile — so it must exist in-context.
COPY patches ./patches

RUN pnpm install --frozen-lockfile --filter "@sp/api..."

# Now bring in the real source for the packages we actually build.
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

# Generates apps/api/src/generated/prisma (gitignored, driver-adapter mode:
# TS + a portable WASM query compiler, no native binary). schema.prisma's
# datasource has no `url`, so this needs no DATABASE_URL — the connection
# string is only ever supplied at runtime via @prisma/adapter-pg.
RUN pnpm --filter @sp/api run prisma:generate

# Builds @sp/contracts first (turbo dependency graph), then @sp/api, per the
# root turbo.json `build` task (`dependsOn: ["^build"]`).
RUN pnpm turbo build --filter=@sp/api...

########################################
# Runtime: slim image + ffmpeg (media-processing shells out to ffmpeg/ffprobe)
########################################
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg
ENV FFPROBE_PATH=ffprobe

# ffmpeg/ffprobe must be on PATH: FFMPEG_PATH/FFPROBE_PATH default to the bare
# binary names (apps/api/src/config/env.ts), and media-processing/probe.ts +
# transcode.ts execFile them directly.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the whole built workspace tree as-is (not just node_modules) so pnpm's
# workspace symlinks (apps/api/node_modules/@sp/contracts -> ../../../packages/contracts)
# keep resolving correctly — a monorepo-safe alternative to `pnpm deploy`,
# which needs git-based ignore rules this repo doesn't have (not a git repo).
COPY --from=builder /app /app

WORKDIR /app/apps/api
EXPOSE 3000

CMD ["node", "dist/main.js"]
