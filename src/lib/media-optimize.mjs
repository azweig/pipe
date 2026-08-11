// Qué optimizador le toca a cada archivo y cómo se valida el resultado.
//
// Medido sobre el CAS real antes de escribir esto: los JPEG que llegan por WhatsApp/cámara ya vienen exprimidos
// (jpegtran sin pérdida rinde ~2%, y 1 de cada 4 no mejora nada), mientras que el VIDEO en H.265 baja ~44%. Por eso
// el video es el que mueve la aguja y el resto es prolijidad. Todo lo de imagen es SIN PÉRDIDA; el video NO (es una
// recodificación) — por eso se verifica que la duración se mantenga antes de reemplazar nada.

export const IMG_LOSSLESS = { ".jpg": "jpegtran", ".jpeg": "jpegtran", ".png": "optipng", ".gif": "gifsicle" }
export const VIDEO_EXTS = [".mp4", ".webm", ".mov"]

// argumentos del optimizador para (entrada → salida). null = no hay optimizador para ese tipo.
export function optimizerFor(ext, inPath, outPath, { crf = 28, preset = "medium" } = {}) {
  const e = String(ext || "").toLowerCase()
  // -copy all conserva el EXIF a propósito: ahí vive la ORIENTACIÓN, y sin ella las fotos verticales se ven de costado.
  // Medido sobre los JPEG más pesados del CAS: copy none 17% vs copy all 16% — un punto no vale rotar las fotos de nadie.
  if (e === ".jpg" || e === ".jpeg") return { tool: "jpegtran", bin: "jpegtran", args: ["-optimize", "-progressive", "-copy", "all", "-outfile", outPath, inPath], lossy: false }
  if (e === ".png") return { tool: "optipng", bin: "optipng", args: ["-o4", "-quiet", "-out", outPath, inPath], lossy: false } // sin -strip: mismo criterio (los metadatos se quedan)
  if (e === ".gif") return { tool: "gifsicle", bin: "gifsicle", args: ["-O3", "-o", outPath, inPath], lossy: false }
  if (VIDEO_EXTS.includes(e)) {
    return { tool: "h265", bin: "ffmpeg", lossy: true,
      args: ["-y", "-loglevel", "error", "-i", inPath, "-c:v", "libx265", "-crf", String(crf), "-preset", preset, "-tag:v", "hvc1", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", outPath] }
  }
  return null
}

// ¿Aceptamos el resultado? Reglas duras — ante la duda, se queda el original.
//  - tiene que existir y pesar algo,
//  - tiene que ser MÁS CHICO con margen real (si gana <3%, no vale re-escribir ni perder el original),
//  - y si es video (recodificación con pérdida), la duración tiene que coincidir: es la señal de que no se cortó.
export function acceptResult({ origSize, newSize, lossy, origDur = null, newDur = null, minGainPct = 3 }) {
  if (!newSize || newSize <= 0) return { ok: false, why: "salida vacía" }
  const gain = 100 - (newSize * 100) / origSize
  if (gain < minGainPct) return { ok: false, why: `ganancia ${gain.toFixed(1)}% < ${minGainPct}%` }
  if (lossy) {
    if (origDur == null || newDur == null) return { ok: false, why: "no pude medir la duración" }
    if (Math.abs(origDur - newDur) > Math.max(0.5, origDur * 0.02)) return { ok: false, why: `duración ${origDur}s → ${newDur}s` }
  }
  return { ok: true, gain }
}

export const pct = (antes, despues) => (antes > 0 ? (100 - (despues * 100) / antes) : 0)
export const mb = (n) => (n / 1048576).toFixed(1) + " MB"
