# pipe.one — Provisioning multi-tenant (Docker por cliente)

Cada cliente = un **stack Docker aislado**: su propia app, su Synapse+Postgres, sus bridges, sus volúmenes.
Cero datos compartidos → la mejor historia de seguridad para enterprise, y sin refactor a multi-tenant compartido.

## Arquitectura (una caja (VPS))

```
                 Caddy (host, :443)  ── TLS + subdominio → puerto del tenant
                   │
   ┌───────────────┼────────────────────────────┐
   │ acme.hub…     │ globex.hub…                 │  (import /etc/caddy/tenants/*.caddy)
   ▼               ▼                             ▼
 /opt/tenants/acme            /opt/tenants/globex        …
  docker-compose (aislado)     docker-compose (aislado)
   ├─ app  (127.0.0.1:3001)     ├─ app (127.0.0.1:3002)
   ├─ synapse + postgres        ├─ synapse + postgres
   ├─ mautrix-whatsapp          ├─ mautrix-whatsapp
   └─ volúmenes: data/ auth/ synapse/ postgres/ bridges/ vault/
```

Cada tenant tiene **su** `hub-config.json` (identidad), `llm-config.json` (motor+token IA), `imap-accounts.json`
(correos, cifrados), `.secret-key` (AES), VAPID (push) y PIN. La app ya es config-por-hub (nada hardcodeado).

## Prerequisitos (en la caja)
- Docker + docker compose, Caddy (host), `envsubst`, `python3`, `openssl`, `ss`.
- Imagen de la app construida:  `docker build -f deploy/Dockerfile -t pipe:latest .`  (desde la raíz del repo)

## Uso

```bash
# alta de cliente (con IA managed out-of-box → cero fricción; el cliente puede pisarla con su propia key vía BYOK)
export MANAGED_OPENAI_KEY="sk-...tu-key-de-la-flota..."   # opcional; si no lo ponés, el cliente configura su IA
sudo -E deploy/provision.sh acme acme.hub.tudominio.com "Juan Pérez" juan@acme.com
#   → crea /opt/tenants/acme, secretos, Synapse+bridge, app en :3001, ruta Caddy, TLS auto. Límites de RAM por tenant (~2GB).

# operar la flota (los 100)
sudo deploy/tenants.sh              # tabla: tenant · subdominio · puerto · estado · lag de ingesta
sudo deploy/tenants.sh logs acme    # logs en vivo de un tenant
sudo deploy/tenants.sh restart acme
sudo deploy/tenants.sh backup-all   # data/auth/vault de todos, CIFRADO → /opt/tenant-backups/*.tar.gz.enc

# monitoreo externo: GET https://<subdominio>/api/health  → {"ok":true,"ingestLagMin":N,"uptimeMin":N} (público, sin PIN)

# provision.sh imprime al final el PIN inicial del tenant → entregáselo al cliente (lo seteamos
# desde DENTRO del container porque detrás de Caddy nadie es "local"; el cliente lo cambia luego en Configuración).

# el cliente entra a https://acme.hub.tudominio.com con su PIN → Configuración:
#   · 🏢 Este hub: su nombre/empresa/números/timezone
#   · 🤖 Motor de IA: su proveedor + token (o self-hosted → nada sale)
#   · 📧 Correo: sus cuentas
#   · 📱 Mensajería (/link): vincula SU WhatsApp por QR/código

# baja de cliente (con backup opcional)
sudo deploy/deprovision.sh acme --backup
```

### 🔑 La llave de los backups

Los backups van cifrados (AES-256, misma receta que el backup del hub). La passphrase se genera sola la primera vez en
`/opt/tenant-backups/.pass`, con permisos 600.

**Copiala a otro lado el día uno.** Sin ese archivo no se puede restaurar ningún backup de ningún cliente, y a propósito
no viaja dentro de los backups: guardar la llave adentro del cofre no protege de nada.

```bash
# restaurar un tenant
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/opt/tenant-backups/.pass \
  -in /opt/tenant-backups/acme-20260814-120000.tar.gz.enc | tar -xzf - -C /opt/tenants/acme
```

Antes estos backups eran un `.tar.gz` en claro: adentro van los mensajes, los tokens de las cuentas conectadas, el hash
del 2º PIN y las notas apartadas por ser de una cuenta secreta — de varios clientes, en una caja compartida.

## Qué está aislado
- **DB** (SQLite por tenant), **media/CAS**, **vault**, **secretos** (clave AES propia), **Matrix+bridges** (WhatsApp de cada uno), **puerto**, **subdominio/TLS**.

## Límites honestos de este V1 (un VPS, una caja)
- **Peso**: cada tenant corre Synapse+Postgres+bridge (~0.7–1.5 GB RAM). En una caja rinde para pocos-decenas, no 100.
- **Registro de bridge**: `provision.sh` automatiza el flujo mautrix (genera config → registration → lo wirea en Synapse). Si un bridge nuevo cambia el formato, verificá `bridges/<x>/config.yaml`. En Docker importan 3 cosas (validadas en el test end-to-end 2026-07-10): homeserver `address: http://synapse:8008`; el bridge debe **bindear `hostname: 0.0.0.0`** (default `127.0.0.1` = solo loopback → Synapse no lo alcanza) y la **registration `url: http://<bridge-container>:29318`** (no `localhost`); `domain: <tenant>.local`. Sin eso: "Homeserver → appservice connection is not working".
- **Sin panel de admin** todavía (alta/baja por CLI). Sin billing/quotas.
- **Backups**: por tenant, a mano/cron (`tar` de `data/ auth/ vault/`). Falta cifrado offsite por tenant.

## Migración para sobrevivir a los primeros 100 clientes (roadmap)
Cuando la caja no dé, mover a algo más robusto **sin cambiar la app** (ya es 12-factor-ish: config por env/archivos):
1. **Orquestación**: Kubernetes (o Nomad) — un Deployment por tenant, o un chart parametrizado; autoscaling, health, rolling updates.
2. **Postgres gestionado** (uno por tenant o multi-DB en cluster) en vez de contenedor por tenant → menos RAM, backups PITR.
3. **Matrix** (lo más pesado): (a) Synapse workers + Postgres compartido con `server_name` por tenant; (b) evaluar homeserver más liviano (Dendrite/Conduit); (c) bridges en nodos dedicados.
4. **Almacenamiento**: media/CAS a object storage (S3/R2) en vez de disco local.
5. **Secretos**: de `.secret-key`/`SECRETS_KEY` a KMS/Vault; correos a **OAuth** (pendiente).
6. **Ruteo**: de Caddy-por-subdominio a un ingress con wildcard + cert-manager.
7. **Observabilidad**: métricas/logs por tenant, alertas de heartbeat.

La app no cambia: cada tenant sigue leyendo su `hub-config.json` + `llm-config.json` + secretos; solo cambia **dónde** corre y **cómo** se orquesta.
