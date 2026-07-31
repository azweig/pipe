# Using Pipe — the user guide

**How to *use* Pipe once it's installed.** For installing/hosting, see [SELF-HOSTING.md](SELF-HOSTING.md) and [DEPLOY.md](DEPLOY.md). For the docs map, see [docs/README.md](README.md).

> The app UI and the AI prompts are in **Spanish**. This guide is in English but quotes the **real Spanish labels** you'll see on screen (in *italics*), so you can follow along. Each section opens with a one-line Spanish summary.

**The mental model.** Pipe pulls every channel into **one thread per person** and adds three AI surfaces on top:
- **Inicio 🏠 (Home)** — what needs you *today*.
- **Radar ✨** — proactive: the AI watches your messages and flags what's slipping, without you asking.
- **Jarvis 🧠** — reactive: *you* ask it anything about your own data.

The bottom nav moves between *Inicio*, the inbox, *Espacios*, *Notas*, *Calendario* and your account. Everything else lives inside a conversation or a contact profile.

---

## 1. The unified inbox

> *Es:* todos tus canales en un solo hilo por persona. WhatsApp, correo, Telegram y SMS del mismo contacto se juntan.

**What it is.** One list of conversations. Every channel a person reaches you on — WhatsApp, email, Telegram, Instagram, Messenger, Discord, SMS, Signal — **collapses into a single thread for that person**, keyed by their identity (phone/email). Message a contact who wrote you by SMS and WhatsApp, and it's *one* conversation with both streams interleaved.

**Where.** The inbox tab (the message list). Tap a row to open the conversation.

**Step by step.**
1. Open the inbox. Rows are sorted by most recent activity; unread threads are highlighted.
2. Tap a thread to read it. Scroll up to load older history — Pipe caches each chat's full history in your browser (IndexedDB), so it's re-downloaded from the server only once.
3. **Reply** from the composer at the bottom (see §3). If a contact has more than one channel, tap the channel picker (*"Responder por…"*) to choose whether your reply goes by WhatsApp or email.
4. **Archive** a thread you're done with from its menu (*Archivar*) — it leaves the main list but stays fully searchable and comes back if the person writes again.
5. **Pin** important threads to the top; **filter** the list by channel or status from the filter controls at the top.

**Tips.**
- SMS and Signal **merge by phone number** into the same thread as that contact's WhatsApp — one person, one conversation.
- A red *"⚠️ … sin señal / Reconectar"* banner means a channel (usually the WhatsApp bridge) dropped — reconnect so you don't miss messages.
- Emails open in a sandboxed viewer that **blocks tracking pixels and remote images** by default (the sender can't tell you opened it).

---

## 2. Search — cheap first, AI when you need it

> *Es:* la lupa busca gratis por nombre/teléfono/correo. El botón robot 🤖 pregunta con IA ("¿qué acordé con Juan?").

Pipe has **two search modes** in the same inbox search bar, because most lookups don't need an LLM.

**⚡ Plain search (default, free, instant).** Type in the search box (*"Buscar por nombre, teléfono o email…"*). It filters your threads/contacts by name, phone or email as you type. Zero tokens, no waiting. Use it to *find a person or a thread*.

**🧠 AI search (opt-in).** Tap the **robot button** in the search bar to switch to AI mode. The placeholder changes to *"Preguntá con IA: '¿qué acordé con Juan?'"*. Type a natural-language question and press **Enter** (it only fires on Enter, so it never burns tokens on every keystroke). This routes through Pipe's cheap **facet router** first and falls back to full AI/RAG over your messages only when needed. Use it to *ask about the content* of your conversations.

**When each fires.**
- Looking for *who* or *which thread* → plain search.
- Asking *what was said / what did we agree / who owes me* → AI search (or ask Jarvis, §3).

**Example AI queries.** *"¿qué me dijo Ana de la factura?"* · *"¿qué acordé con Juan?"* · *"¿quién me debe plata?"*

---

## 3. The AI layer — summaries, briefs, drafts

> *Es:* resúmenes de chats y audios, tu resumen del día, quién espera respuesta, y borradores escritos en tu voz.

Pipe's AI reads your inbox for you. It appears in a few places:

**Daily brief (Inicio 🏠).** A cron generates your home screen a few times a day: a greeting, a short brief, your agenda, and action cards. Open *Inicio* to see the state of your day at a glance.

**"Necesitan respuesta" — who's waiting on you.** On *Inicio*, the *"↩️ Necesitan respuesta"* card lists everyone who wrote and hasn't gotten a reply. Each has three buttons:
- **✍️ Responder** — jump into that conversation.
- **✨ Borrador IA** — the AI drafts a reply for you.
- **✓ Listo** — dismiss it (it won't come back).

**Thread & voice-note summaries.** Inside any conversation, open the **✨ IA** menu:
- *💬 Sugerir respuesta* — drafts a reply **in your voice**, based on the conversation. It lands in the composer for you to edit before sending — nothing is sent automatically.
- *📝 Resumir chat* — summarize the thread over *Último día / semana / mes / desde el principio*. The summary is **saved into the chat for you** (a private note), not sent to anyone.
- *Corrección ortográfica* — toggle spell-check underlines while you type.

**Drafting in your voice.** Both *Sugerir respuesta* and *✨ Borrador IA* write in your style with that specific contact — they mimic how *you* talk to *that* person, learned from your own history.

**Radar ✨ (proactive) vs Jarvis 🧠 (reactive).**
- **Radar** watches and *tells you*: *"No te contestaron (reinsistir)"*, *"Te preguntaron y no respondiste"*, people to reconnect with, plus generative tools (*📰 Novedades de redes*, *✍️ Posts LinkedIn*, *📊 Review* semanal). Nothing urgent from *today* is duplicated here — that's on *Inicio*.
- **Jarvis** answers what *you* ask. Use the ask bar on *Inicio* (*"preguntale lo que sea sobre tus datos"*) or open *Jarvis*: *"¿quién me debe?"* · *"resumime a Juan"* · *"¿qué quedó con X?"*.

**Autopilot 🏖️ (Piloto automático) — optional, per contact.** In a contact's profile, *🏖️ Piloto automático* lets the AI **answer simple questions on its own, in your voice with that person**. It's deliberately conservative: it won't accept meetings or commitments, won't send photos, won't invent data, and **escalates anything non-trivial to you**. You can cap it (e.g. max replies/day) and turn it off anytime. Start with it **off** and enable it only for low-stakes contacts once you trust the drafts.

---

## 4. Transcribe & summarize any media

> *Es:* mantené presionado (app) o el menú ⋯ (web) sobre un audio/video/imagen → lo transcribe y te da un resumen en español.

**What it is.** On-demand transcription + summary for any voice note, video or image in a thread — even if the clip is in English, Japanese, etc. It **auto-detects the language** and gives you a **Spanish summary**.

**Where / step by step.**
1. **In the web app:** open the message's **⋯ menu** and pick *transcribir/resumir*. **In the mobile app:** **long-press** the media message.
2. Pipe transcribes it (locally, via whisper, if configured — the audio never leaves your box) and returns the transcript plus a short summary.
3. The result is saved on the message so you don't have to re-run it.

**Tips.** Speech-to-text runs **locally** when `WHISPER_BIN` is set — private and free. Images go through vision to describe/extract text (useful for receipts, screenshots, PDFs).

---

## 5. Spaces & Rules (Espacios)

> *Es:* agrupá la bandeja por relevancia. La IA arma grupos automáticos por relación; vos creás los tuyos (por dominio, teléfono, nombre…). Ej.: un espacio "Bancos".

**What it is.** *Espacios* turn your inbox into tabs by relevance, so work, family and noise don't share one list.

**Where.** The *Espacios* tab → the groups sheet (*"Organizá la bandeja por relevancia — cada grupo es una pestaña"*).

**Two kinds of spaces.**
- **Automatic** — the AI builds these by relationship (e.g. work vs personal). You can **rename** or **hide** them.
- **Yours** — create a space and assign contacts to it, or define it by a **rule**: an email domain, a phone number, a name pattern. Anything matching the rule rolls up into that space automatically, including future messages.

**Example — a "Bancos 🏦" space.** Create a space and add a rule matching your banks' email domains and sender names; every statement and alert from any bank now lands in one tab.

**Tips.** Rules are the power feature — one domain rule beats tagging threads one by one. Hide the auto-groups you don't care about to keep the tab bar clean.

---

## 6. Notes AI (#notas) and Voice notes (🎤)

> *Es:* escribí #notas o mandate audios; la IA los ordena, saca acciones y podés chatear con tus notas.

**Notes (Notas).** Your self-notes become a second brain. In the *Notas* tab:
- Jot a quick note; the AI files it, detects a category and any **actions/reminders** inside it, and periodically reflects on them (*"La IA piensa"* shows its take + topics).
- **Ask your notes** — a chat box over everything you've noted (*"¿qué anoté sobre…?"*).
- The digest **regenerates** on a schedule; you can also refresh it.

**Voice notes (🎤).** Tap the **🎤** button to record real audio. It's transcribed locally and filed as a note — so it flows through the same Notes pipeline (category, detected actions, summary). Great for capturing a thought while walking.

**Tips.** Drop any external audio (phone memos, meeting recordings, Plaud exports) into the recordings folder (`RECORDINGS_DIR`) and Pipe transcribes + files it the same way — no recorder API needed.

---

## 7. Calendar (Calendario) and Todos / pending

> *Es:* el Calendario arma tarjetas de tus reuniones; los pendientes y promesas salen solos de tus conversaciones.

**Calendar (Calendario).** The *Calendario* tab shows pre-generated cards for your upcoming meetings (built by a cron, with the right people and context). Your next meeting also surfaces on *Inicio*. When you're replying to schedule something, tapping a **free slot** adds *"a las HH:MM"* to your draft (it doesn't send — you review and hit send).

**Todos & pending.** Pipe extracts action items straight from your conversations, each **grounded in a quoted line** so nothing is invented:
- **Todos** — tasks it found you need to do.
- **Promises (🤝)** — things *you* promised someone (*"Prometiste: …"*, flagged *sin cerrar* until done).
- **Waiting (⏳)** — things you're still owed / people who haven't replied.

These show on *Inicio* and *Radar*. Tap any card to jump to the exact conversation.

**Tips.** A todo/promise only appears if there's a real textual citation for it — if something's missing, it's because the source line wasn't clear enough (by design, to avoid hallucinated tasks).

---

## 8. Covert mode ("El Santo")

> *Es:* mandá un mensaje que se ve como un poema/cuento/receta pero que la otra persona con Pipe descifra al texto real.

Send a message that looks like an innocuous poem, story, recipe or prayer to anyone who sees it (e.g. on WhatsApp), but **decrypts to the real text** for a contact who has Pipe and the shared passphrase. Real authenticated encryption (AES-256-GCM) under a natural-looking cover.

**Quick start.** Open the **contact's profile** → *🕊️ Configurar*, set a **shared key** and pick a **style**, preview, and enable. A *🕊️* toggle then appears in that chat's composer — with it on, you type normally and the message travels disguised. Both sides see it **decrypted**, with a *"ver original"* to see the cover text. Someone without Pipe can decrypt at **`<your-hub>/decrypt`** with the key.

**Full details:** [COVERT.md](COVERT.md).

---

## 9. Import your WhatsApp history

> *Es:* WhatsApp → "Exportar chat" → subí el .txt (o .zip con multimedia) en Pipe. Se fusiona en el hilo correcto sin duplicar.

**What it is.** Bring old WhatsApp chats in **without root and without a PC**. (WhatsApp has no "export everything" — this is per-chat.)

**Step by step.**
1. In **WhatsApp**, open the chat → **Export chat** (*Exportar chat*). Choose **without media** (a `.txt`) or **with media** (a `.zip`).
2. In Pipe, go to the import option in settings (*historial*) and upload the file. `.txt` up to 64 MB; `.zip` (with photos/audio/video) up to 512 MB.
3. Pipe parses it (handles iOS/Android formats), **de-duplicates** against what's already there, and **merges it into the right thread** — re-keying to the contact's real identity so it lands in their existing conversation.

**Tips.** Import the `.zip` when you want the old photos and voice notes too, not just text.

---

## 10. Push notifications (🔔)

> *Es:* tocá 🔔 para que suenen los mensajes nuevos. En iPhone hay que instalar la PWA primero.

**What it is.** Web Push so new messages ring/vibrate on your phone even when the app is closed.

**Step by step.**
1. Tap the **🔔** banner (*"Activá las notificaciones"*) on *Inicio*, or the bell in *Radar*, and allow notifications when the browser asks.
2. That's it on Android/desktop.
3. **On iPhone:** iOS only allows Web Push for **installed PWAs**. First *Add to Home Screen* from Safari, open Pipe from that icon, **then** enable notifications.

**Tips.** If notifications stop, re-enabling from the 🔔 banner re-subscribes the device.

---

## 11. Use it from Claude / any AI (MCP)

> *Es:* conectá Claude (u otro cliente MCP) a tu inbox y preguntale por tus mensajes desde ahí.

**What it is.** Connect Claude Desktop/Code (or any MCP client) to your hub. Now you can ask **your assistant** about your inbox from *its* window — *"buscá qué me dijo Ana de la factura"*, *"¿qué tareas tengo pendientes?"* — and it reads your threads/todos to answer.

**What it can do.** Read is always on (`search_inbox`, `get_thread`, `list_todos`). **Writing** (reply / forward / create-todo) is **off by default** and, when you turn it on, asks you to **confirm** each outward send. The connector never sends your data anywhere on its own — the only place results go is the assistant *you* chose to connect.

**Set up:** [MCP.md](MCP.md) — a few lines in your MCP client's config, local or over SSH (no open ports).

---

## More

- **Connecting a channel for the first time?** The in-app *"❓ Cómo conectar"* sheet (under *Configuración → Agregar conexión*) has step-by-step guides per source; the full walkthrough is in [SELF-HOSTING.md](SELF-HOSTING.md).
- **Something broken?** See the troubleshooting table in [SELF-HOSTING.md](SELF-HOSTING.md) or open an issue.
</content>
</invoke>
