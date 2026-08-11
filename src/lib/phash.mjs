// HUELLA PERCEPTUAL (dhash) — para detectar la MISMA imagen/video que entró por dos canales distintos.
//
// El CAS dedupea por sha256 del contenido: dos bytes iguales = un solo archivo. Pero la misma foto reenviada por
// WhatsApp y por mail llega re-codificada → bytes distintos → dos copias. Eso el hash exacto no lo ve nunca, y
// recomprimir tampoco lo arregla (dos codificaciones distintas no convergen a los mismos bytes).
//
// dhash: se escala la imagen a 9x8 en gris y se compara cada píxel con el de su derecha → 64 bits. Sobrevive a
// recompresión, cambios de calidad y reescalado; cambia mucho si la imagen es OTRA. Comparación = distancia de Hamming.

// dhash a partir del raw gris de 9x8 (72 bytes) que escupe ffmpeg. PURA: sin ffmpeg ni disco, testeable.
export function dhashFromGray9x8(buf) {
  if (!buf || buf.length < 72) return null
  let bits = ""
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += buf[y * 9 + x] > buf[y * 9 + x + 1] ? "1" : "0"
  // 64 bits → 16 hex. Se arma de a nibbles para no depender de BigInt ni perder precisión.
  let hex = ""
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

// distancia de Hamming entre dos huellas hex (0 = idénticas). ≤5 sobre 64 bits ya es "la misma imagen".
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64
  const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] // bits en 1 por nibble
  let d = 0
  for (let i = 0; i < a.length; i++) d += POP[(parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 15]
  return d
}

// ¿vale la pena huellar esto? Solo imagen/video: un PDF o un zip no tienen "parecido visual".
export const PHASH_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"]
export const isVideoExt = (ext) => [".mp4", ".webm", ".mov", ".mkv", ".avi"].includes(String(ext).toLowerCase())

// comando ffmpeg para sacar el raw 9x8 gris. En video se toma un fotograma ~1s adentro (el 0 suele ser negro).
export function ffmpegPhashArgs(path, ext) {
  const pre = isVideoExt(ext) ? ["-ss", "1"] : []
  return [...pre, "-i", path, ...(isVideoExt(ext) ? ["-frames:v", "1"] : []), "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-"]
}
