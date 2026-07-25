# Imagen de la app pipe (server + daemon + readers). Un contenedor por tenant.
# Build:  docker build -f deploy/Dockerfile -t pipe:latest .   (contexto = raíz del repo)
FROM node:20-bookworm-slim

# ffmpeg = audio/voz (notas de voz, STT) · toolchain = rebuild de better-sqlite3 nativo · git = dep libsignal de Baileys
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 make g++ ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# libsignal (dep de Baileys) se resuelve por git+ssh en el lock → reescribir a https (repo público, sin credenciales SSH)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/" \
 && git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

# deps primero (cache) → rebuild nativo de better-sqlite3 para la arch del contenedor
COPY package*.json ./
RUN (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force

# código de la app (data/auth/vault van montados como VOLÚMENES, ver .dockerignore)
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
# el daemon levanta el server web (:3000) + todos los readers, y los reinicia si mueren
CMD ["node", "src/daemon.mjs"]
