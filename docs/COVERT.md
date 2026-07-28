# Pipe — modo encubierto ("El Santo")

Enviá un mensaje que **cualquiera que lo vea lee como un poema** (o un cuento, una receta, una oración), pero que la otra persona con la clave **descifra y ve el mensaje real**. Cifrado de verdad por debajo, disfrazado de texto natural por arriba. El nombre viene de la película *El Santo*, donde se codifican frases coherentes con dos diccionarios.

> **Probalo sin instalar nada:** [pipe.one/secret-messages](https://pipe.one/secret-messages) — cifrá y descifrá en tu navegador.

## Qué hace

1. Escribís un mensaje normal y una **clave compartida** (que acordaste con la otra persona por un canal seguro).
2. Pipe lo **cifra** (AES‑256‑GCM) y codifica los bytes cifrados en un **texto tapadera** que se lee como lenguaje natural pero está semánticamente vacío.
3. Ese texto lo mandás por donde quieras (WhatsApp, email, un papel). Quien no tenga la clave lee un poema.
4. La otra persona lo revierte: **automáticamente si usa Pipe** con la misma clave, o pegándolo en un **decodificador web** si no tiene Pipe.

Ejemplo — *"nos vemos mañana 3pm en el café"* con estilo poema:

```
Luna arde y dorado,
Mar espera contra piedra,
Abismo vuela y roto,
…
```

## Cómo funciona (dos capas)

**1. Cifrado real.** `seal(text, passphrase)`:
- Clave = `PBKDF2-SHA256(passphrase, salt, 200k iteraciones)`.
- **Salt aleatorio de 8 bytes POR MENSAJE**, embebido en el blob. Esto mata el **precómputo** (rainbow tables): no existe una tabla reutilizable contra "todas las cuentas"; cada mensaje obliga a recalcular el KDF desde cero. El salt **no es secreto** (va en claro en el mensaje) — el secreto es la **passphrase**.
- Cifrado `AES‑256‑GCM` (tag de 8 bytes). Blob = `salt(8) + iv(12) + tag(8) + ciphertext`.

**2. Codificación esteganográfica.** Los bytes del blob se mapean a palabras usando **gramáticas por estilo** (poema / cuento / receta / oración). Cada estilo tiene diccionarios de largo potencia‑de‑2: cada palabra codifica `log2(N)` bits. Un ciclo de plantilla (`{lit}` palabra fija + `{slot}` palabra que lleva bits) se repite hasta agotar los bits, y se le da formato (versos, puntuación) que **no altera la secuencia de palabras**. El decodificador hace el camino inverso; el tag GCM **autentica** el resultado, así que un texto ajeno o una clave equivocada **fallan** (no hay falsos positivos).

Todo esto vive en un módulo puro y sin dependencias: [`src/lib/covertext.mjs`](../src/lib/covertext.mjs), con tests en `test/covertext.mjs`.

## Seguridad — qué protege y qué no

- **Confidencialidad: fuerte, depende de la passphrase.** Sin la clave, nadie lee el mensaje aunque conozca el algoritmo (el código es abierto). El salt por‑mensaje evita el precómputo.
- **Detectabilidad: moderada.** Un analista que conozca *este* esquema podría notar que el texto usa nuestros diccionarios (esteganografía detectable), pero **igual no puede descifrarlo** sin la clave.
- **El salt y el algoritmo son públicos a propósito.** La seguridad NO está en el disfraz ni en ocultar el método, sino en la clave. Compartila por un canal seguro (en persona, llamada) y elegí una buena.
- **Contra honesta: el texto tapadera es largo.** Un mensaje corto (~35 caracteres) → un poema de ~140 palabras. Es esteganografía coherente: poca densidad de bits. **Ideal para notas cortas.**

## Los dos decodificadores

Ambos son **100% client‑side**: la clave y el descifrado **nunca salen del navegador**, no se envía nada a ningún servidor. Son páginas HTML+JS estáticas (Web Crypto). Por eso da igual dónde estén hospedadas para la seguridad.

| | URL | Para qué |
|---|---|---|
| **El de tu instalación** | `https://<tu-hub>/decrypt` | El que usás de verdad. Cada hub sirve el **suyo**, **público (sin PIN)** — el que recibe tu mensaje no tiene acceso a tu hub, y no depende de pipe.one. Es `public/decrypt.html`, servido antes del gate de auth. |
| **Playground público** | [pipe.one/secret-messages](https://pipe.one/secret-messages) | Para que cualquiera pruebe la idea (cifrar y descifrar). Difusión. |

La app y la web, al configurar el modo encubierto para un contacto, ya apuntan al **`/decrypt` de tu propio hub**.

## Cómo usarlo

**En la web (PWA) o la app:**
1. Entrá al **perfil del contacto** (web) o tocá **🕊️ en el header del chat** (app).
2. Card/panel **"Modo encubierto"**: poné la **clave compartida**, elegí el **estilo** (podés uno distinto por contacto) y mirá la **vista previa**.
3. **Activá.** En el chat aparece el toggle 🕊️ / el switch "Enviar encubierto". Con eso ON, escribís normal y el mensaje viaja cifrado‑disfrazado.
4. Los mensajes encubiertos (tuyos y de la otra persona) se muestran **descifrados**, con un "🕊️ descifrado · ver original" para ver el poema tal cual lo ve WhatsApp.

**Para el que recibe y no tiene Pipe:** pasale la clave y decile que entre a **`<tu-hub>/decrypt`**, pegue el texto y ponga la clave.

## API

Todo detrás del PIN salvo `/decrypt` (público, client‑side).

| Endpoint | Qué hace |
|---|---|
| `GET /api/covert/config?key=<hilo>` | Estado del modo encubierto de ese contacto (habilitado, estilo, estilos disponibles). No expone la clave. |
| `POST /api/covert/config` `{key, pass, style}` | Configura (o desactiva con `pass:""`). La passphrase se guarda **cifrada** con `SECRETS_KEY`. |
| `POST /api/covert/preview` `{text, pass, style}` | Vista previa: devuelve el texto tapadera. |
| `POST /api/send` `{key, text, covert:true}` | Envía cifrando‑disfrazando antes de mandar. |
| `GET /decrypt` (y `/decodificar`) | Decodificador web público (client‑side). |

Los mensajes entrantes se descifran al vuelo cuando el contacto tiene clave configurada (`enrichCovert` en el hilo), sin escribir nada extra en la base.
