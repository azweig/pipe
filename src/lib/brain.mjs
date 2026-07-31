// brain.mjs — FACHADA del segundo cerebro (capa de datos/consulta que usan el server web y los crons).
// Post-split (candidato #2, god object #2 disuelto): CERO lógica propia — solo re-exporta los feature modules por dominio.
// Cada nombre público vive en su módulo (inbox/reply/schedule/meetings/people/coach/espacios/social/notes/ask/home/status)
// + kernels internos (keys/contacts/vault/convo/objetivos/jsonl) que NO cruzan la fachada. Agregar API = un `export *` más.
export * from "./brain/notes.mjs"
export * from "./brain/ask.mjs"
export * from "./brain/social.mjs"
export * from "./brain/coach.mjs"
export * from "./brain/espacios.mjs"
export * from "./brain/schedule.mjs"
export * from "./brain/meetings.mjs"
export * from "./brain/people.mjs"
export * from "./brain/reply.mjs"
export * from "./brain/autopilot.mjs"
export * from "./brain/inbox.mjs"
export * from "./brain/covert.mjs"
export * from "./brain/media-ai.mjs"
export * from "./brain/home.mjs"
export * from "./brain/status.mjs"
