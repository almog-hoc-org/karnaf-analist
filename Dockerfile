# Karnaf Analist — production image.
#
# WHY DOCKER AT ALL, ON A SERVER THAT ALREADY RUNS THINGS DIRECTLY
# This VPS also runs an OpenClaw bot as a bare host process, and that bot must
# not be disturbed. A container gives isolation for free: separate filesystem,
# separate dependencies, and — the reason that actually decided it — a pinned
# Node version.
#
# The host runs Node 24. Every one of the ~3,000 lines of changes in this repo
# was verified on Node 22, against Next.js 14 and a native better-sqlite3
# binding. Building on the host would mean shipping something nobody has run.
# Pinning 22 here means what was tested is what executes.
FROM node:22-bookworm-slim

# better-sqlite3 is a native addon. A prebuilt binary usually exists, but when
# it does not, npm falls back to compiling — and a missing compiler surfaces as
# a confusing install failure rather than a clear one. These are cheap insurance.
# python3 is also used by the CBS report parsers at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      build-essential \
      ca-certificates \
      sqlite3 \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The Python half of the data pipeline. Three TypeScript modules spawn python3
# to read PDFs and Excel — the formats the CBS and the Chief Economist actually
# publish in — and none of those libraries were ever installed here. The image
# had python3 and no packages, so every document-extraction path was dead on
# arrival while looking, from the outside, like sources that had nothing new.
#
# --break-system-packages: Debian bookworm marks its python3 as externally
# managed (PEP 668). In a container with one application and no OS-level python
# consumers, a virtualenv buys isolation from nothing, and installing into the
# system interpreter keeps the spawn calls in lib/*.ts working without a path
# dance. Its own layer, before COPY . ., so a code change does not reinstall it.
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt \
    && python3 -c "import pdfplumber, fitz, openpyxl; print('✓ python extraction stack ready')"

# Dependencies first, as their own layer: package.json changes far less often
# than source, so a normal code deploy skips the slowest step entirely.
COPY package.json package-lock.json* ./
RUN npm ci

# Prisma's client is generated from the schema, so the schema must land before
# the generate step. Prisma 7 reads prisma.config.ts, so that comes too.
COPY prisma ./prisma
COPY prisma.config.ts* ./
RUN npx prisma generate

COPY . .

# Build-time public env. NEXT_PUBLIC_* values are INLINED into the client bundle
# at build time, so this cannot be supplied later at runtime — changing the base
# path means rebuilding, which is exactly the intent (see lib/basePath.ts).
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

# Same rule, same reason: NEXT_PUBLIC_CLARITY_ID is read by a client component,
# so its value is baked into the browser bundle here. Passing it only at run
# time does nothing at all — the built bundle would still contain the empty
# string, and Clarity would silently never load.
ARG NEXT_PUBLIC_CLARITY_ID=""
ENV NEXT_PUBLIC_CLARITY_ID=$NEXT_PUBLIC_CLARITY_ID

# The build reads the database (generateStaticParams, and any page that queries
# during collection). The real database is bind-mounted at run time; here we
# only need the schema to exist so the build can complete. If a database is
# already mounted at build time this is a no-op.
RUN mkdir -p data && \
    (test -s data/realestate.db || npx prisma db push --url="file:/app/data/realestate.db" --accept-data-loss) && \
    npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# Stash the shipped JSON where the data volume cannot hide it.
#
# docker-compose bind-mounts the host's data directory over /app/data, which
# REPLACES the directory rather than merging with it — so every data/*.json in
# this image became unreachable at run time. The server was running with 5 of 28
# files, four of the missing ones read by the site itself, each reader falling
# back to empty without a word. The entrypoint copies anything absent back in on
# start, and never overwrites: some of these files are live collector state.
RUN mkdir -p /app/data-seed && \
    (cp data/*.json /app/data-seed/ 2>/dev/null || true) && \
    echo "seed files: $(ls -1 /app/data-seed | wc -l)"
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Traefik decides a container is healthy before routing to it; /api/health is a
# pure liveness probe that touches no database, which is what makes it safe to
# poll every 30s. (/api/status is the data-freshness check — deliberately NOT
# used here, because a stale pipeline must not take the site out of rotation.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:3000${NEXT_PUBLIC_BASE_PATH}/api/health" || exit 1

CMD ["npm", "run", "start"]
