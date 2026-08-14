# Pipe — self-host image. Multi-stage: compile native deps (better-sqlite3) in a full image,
# then ship a slim runtime. Node 20 is pinned on purpose: Node 25 breaks Baileys' crypto path
# and the better-sqlite3 ABI (see .nvmrc).

# ── build stage: native toolchain for better-sqlite3 ──────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
# git = dep libsignal de Baileys · toolchain = build nativo de better-sqlite3.
# Sin `git` el build fallaba en las DOS ramas del npm de abajo, así que `docker compose up --build` —el camino que el README
# y la landing ofrecen como el más fácil— no compilaba nunca. deploy/Dockerfile ya lo tenía resuelto; este quedó atrás.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*
# libsignal se resuelve por git+ssh en el lock → reescribir a https (repo público, sin credenciales SSH en la imagen)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/" \
 && git config --global url."https://github.com/".insteadOf "git@github.com:"
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# ── runtime stage: slim + ffmpeg (voice notes) + CA certs (outbound TLS) ───────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# node_modules (with the compiled better-sqlite3) from the build stage
COPY --from=build /app/node_modules ./node_modules
# app code — .dockerignore keeps data/auth/vault/.env/.git out of the image
COPY . .
# persistent state lives in mounted volumes, never baked in; run as non-root
RUN mkdir -p data auth vault \
  && useradd -r -u 10001 -m pipe \
  && chown -R pipe:pipe /app
USER pipe
VOLUME ["/app/data", "/app/auth", "/app/vault"]
EXPOSE 3000
# daemon = web UI/API + all channel readers (production parity).
# For a calm first run (web only, no readers), override: command: ["npm","run","web"]
CMD ["node", "src/daemon.mjs"]
