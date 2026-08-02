# Stack AISLADO por tenant. Se renderiza con envsubst desde provision.sh.
# Cada tenant: su app + su Synapse + su Postgres + sus bridges + sus volúmenes → cero data compartida.
name: pipe-${TENANT}

services:
  app:
    image: pipe:latest
    restart: unless-stopped
    mem_limit: 640m          # límite por tenant → uno no puede voltear la caja
    depends_on: [synapse]
    environment:
      MATRIX_HS: "http://synapse:8008"
      MATRIX_DOMAIN: "${TENANT}.local"
      MATRIX_USER: "admin"
      MAUTRIX_WA_DB: "/bridges/whatsapp/mautrix-whatsapp.db"
      BRIDGES_ENABLED: "whatsapp"   # solo el bridge que trae el stack → /link no ofrece canales sin bridge (colgarían). Agregá más acá si sumás bridges.
      SECRETS_KEY: "${SECRETS_KEY}"
      TENANT: "${TENANT}"
      TRUSTED_HOSTS: "${SUBDOMAIN}"   # allowlist anti DNS-rebinding: hostAllowed() SOLO se activa con esta var → el tenant responde únicamente a su subdominio
      HOST: "0.0.0.0"          # bindea a todas las interfaces DENTRO del container (Docker publica a 127.0.0.1:${APP_PORT} → Caddy → gate PIN)
      OPENAI_API_KEY: "${MANAGED_OPENAI_KEY}"   # IA MANAGED por defecto (out-of-box). El cliente puede pisarlo con su propia key (BYOK gana).
    volumes:
      - ./data:/app/data          # SQLite + configs (hub-config/llm-config) + snapshots del tenant
      - ./auth:/app/auth          # tokens Matrix, imap-accounts, PIN, vapid
      - ./vault:/app/vault        # Obsidian del tenant
      - ./bridges:/bridges:ro     # lee la DB del bridge (fotos/portales) del stack Matrix del tenant
    ports:
      - "127.0.0.1:${APP_PORT}:3000"   # Caddy del host lo enruta por el subdominio

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    mem_limit: 384m
    environment:
      POSTGRES_USER: synapse
      POSTGRES_PASSWORD: "${PG_PASS}"
      POSTGRES_DB: synapse
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    volumes:
      - ./postgres:/var/lib/postgresql/data

  synapse:
    image: matrixdotorg/synapse:latest
    restart: unless-stopped
    mem_limit: 768m
    depends_on: [postgres]
    volumes:
      - ./synapse:/data
    # sin puerto en el host: solo la app y los bridges (misma red) le hablan

  mautrix-whatsapp:
    image: dock.mau.dev/mautrix/whatsapp:latest
    restart: unless-stopped
    mem_limit: 320m
    depends_on: [synapse]
    volumes:
      - ./bridges/whatsapp:/data

  # agregá más bridges igual que arriba cuando el tenant los pida (telegram/discord/meta):
  # mautrix-telegram:
  #   image: dock.mau.dev/mautrix/telegram:latest
  #   restart: unless-stopped
  #   depends_on: [synapse]
  #   volumes: [./bridges/telegram:/data]
