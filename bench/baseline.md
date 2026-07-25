# Coverage de tiempos — baseline

Correr `node bench/time-coverage.mjs` en el server tras cada deploy y comparar contra esta tabla.
Estado: ✅ en rango · ⚠️ límite · ❌ fuera. Objetivo lo define el owner del hub.

## Objetivos del owner (2026-07-08)
- Abrir Mensajes: era 3–5 s → debe ser rápido. **Causa:** scan de espacios (name=/dominio sobre 1.96M). **FIX:** pre-gen rollup → **6 ms** ✅
- Abrir IA: era ~5 s → rápido. Misma causa (threads). **FIX:** idem → **1 ms** ✅
- Abrir persona: era ~2 s + data mal armada. **FIX:** dedup grafo + tz. Ahora **2 ms** ✅
- Calendario "duplicado": evento Outlook naive parseado con tz del server. **FIX:** naive→Lima. ✅

## Baseline 2026-07-08 v2 (POST-fix espacios+tz, mediana de 5, localhost)
| Espacio (vista) | `/api/espacio/view` | **1 ms** (era 5658) | ✅ | pre-gen rollup (cron cada 4min) |
| Bandeja / IA / Coach / Persona / Evento | varios | **1–6 ms** | ✅ | todo pre-generado |
| Corrección al enviar | `/api/compose/correct` | **884 ms** | ⚠️ | LLM cloud; sub-500ms solo con Groq |

## Baseline 2026-07-08 v1 (mediana de 5, localhost, server bajo carga normal)

| Función (pantalla) | Endpoint | Mediana actual | Objetivo | Estado | Nota |
|---|---|---:|---:|:--:|---|
| Bandeja (inbox) | `/api/threads` | 7 ms* | ? | ✅ | *cache-warm; cold incluye scan de espacios (ver abajo) |
| Home | `/api/home` | 3 ms | ? | ✅ | lee snapshot pre-generado |
| Calendario · Día | `/api/calendar` | 7 ms | ? | ✅ | agregado en vivo + tarjetas pre-gen |
| Calendario · Semana | `/api/calendar` | 8 ms | ? | ✅ | |
| Abrir conversación | `/api/thread` | 19 ms | ? | ✅ | |
| Targets de hilo | `/api/thread/targets` | 19 ms | ? | ✅ | |
| Persona (Graphify) | `/api/person` | 1 ms | ? | ✅ | tarjeta pre-generada |
| Detalle de evento | `/api/meeting` | 1 ms | ? | ✅ | tarjeta pre-generada |
| **Espacio (vista)** | `/api/espacio/view` | **5658 ms** | ? | ❌ | LIKE `%@dominio` + `name=` = full scan de 1.96M msgs, ×2 (count+recent). Afecta también el cold-load de la bandeja. FIX: pre-generar rollup de espacios (como las otras tarjetas) o índice/columna de dominio. |
| Coach / IA | `/api/coach` | 2 ms | ? | ✅ | stale-while-revalidate |
| Agenda | `/api/agenda` | 3 ms | ? | ✅ | |
| Espacios (lista) | `/api/espacios` | 2 ms | ? | ✅ | |
| Objetivos | `/api/objetivos` | 2 ms | ? | ✅ | |
| Empresas | `/api/companies` | 2 ms | ? | ✅ | |
| **Corrección al enviar** | `/api/compose/correct` | **937 ms** | ? | ⚠️ | openai gpt-4o-mini (red+LLM). Sub-500ms solo con Groq. Ver [[pipe_correct_perf]]. |
