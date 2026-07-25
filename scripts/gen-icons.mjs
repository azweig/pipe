// Genera los iconos PWA (public/icon-192.png y -512.png) SIN dependencias — encoder PNG puro con zlib.
// Diseño: fondo índigo redondeado + orbe menta con brillo (la marca 🧠 del hub). Correr:  node scripts/gen-icons.mjs
import { deflateSync } from "zlib"
import { writeFileSync } from "fs"
import { crc32 } from "zlib"

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}
function png(size) {
  const S = size, cx = S / 2, cy = S / 2
  const buf = Buffer.alloc(S * (S * 4 + 1))
  const px = (x, y, r, g, b, a = 255) => { const o = y * (S * 4 + 1) + 1 + x * 4; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a }
  const rad = S * 0.22 // radio de esquinas redondeadas
  const inCorner = (x, y) => { // fuera del rounded-rect → transparente
    const dx = Math.max(rad - x, x - (S - rad), 0), dy = Math.max(rad - y, y - (S - rad), 0)
    return Math.hypot(dx, dy) <= rad || (dx === 0 || dy === 0)
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inCorner(x, y)) { px(x, y, 0, 0, 0, 0); continue }
    // fondo índigo con leve degradé vertical
    const t = y / S; let r = Math.round(99 - 20 * t), g = Math.round(102 - 30 * t), b = Math.round(241 - 40 * t)
    // orbe menta centrado
    const d = Math.hypot(x - cx, y - cy), orb = S * 0.28
    if (d < orb) {
      const k = 1 - d / orb // 1 centro → 0 borde
      r = Math.round(127 + (189 - 127) * (1 - k)); g = Math.round(208 + (238 - 208) * (1 - k)); b = Math.round(192 + (222 - 192) * (1 - k))
      // brillo arriba-izquierda
      const hl = Math.hypot(x - (cx - orb * 0.3), y - (cy - orb * 0.3))
      if (hl < orb * 0.4) { const s = 1 - hl / (orb * 0.4); r += Math.round(60 * s); g += Math.round(30 * s); b += Math.round(40 * s) }
    }
    px(x, y, Math.min(r, 255), Math.min(g, 255), Math.min(b, 255), 255)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(buf)), chunk("IEND", Buffer.alloc(0))])
}
for (const s of [192, 512]) { writeFileSync(`public/icon-${s}.png`, png(s)); console.log(`✅ public/icon-${s}.png`) }
