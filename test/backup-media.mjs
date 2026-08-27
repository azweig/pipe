// LA MEDIA NO SE RESPALDABA — el backup diario sube ~1,6 GB (base + configs + auth/) y deja afuera los ~60 GB del
// CAS: todas las fotos, audios y videos. Lo peor del caso: cas.db SÍ va en el bundle, así que un restore sabía
// exactamente qué archivos debería haber… y no tenía ninguno. Un backup así da una falsa sensación de estar cubierto.
// Runner: node --test test/backup-media.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SH = readFileSync("scripts/backup.sh", "utf8")
const MJS = readFileSync("scripts/backup-media.mjs", "utf8")

test("el backup diario también sube la media", () => {
  assert.match(SH, /node scripts\/backup-media\.mjs/)
  const iBundle = SH.indexOf("node scripts/backup-drive.mjs")
  const iMedia = SH.indexOf("node scripts/backup-media.mjs")
  assert.ok(iBundle < iMedia, "primero el bundle (chico y crítico), después la media")
})

test("si la media falla, el bundle igual queda subido", () => {
  assert.match(SH, /node scripts\/backup-media\.mjs \|\| echo/, "no puede cortar el backup con set -e")
})

test("va cifrada con la MISMA passphrase que el resto (o no se podría restaurar)", () => {
  assert.match(MJS, /openssl enc -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -salt -pass file:\$\{PASS\}/)
  assert.match(MJS, /const PASS = "secrets\/backup\.pass"/)
})

test("es incremental: un lote sin cambios no se vuelve a subir", () => {
  assert.match(MJS, /if \(prev && prev\.n === h\.n && prev\.bytes === h\.bytes\) \{[^}]*continue/)
})

test("el estado se anota DESPUÉS de subir (si muere antes, se reintenta)", () => {
  const i = MJS.indexOf("await drive.files.create")
  const j = MJS.indexOf("writeFileSync(ESTADO")
  assert.ok(i > 0 && j > i, "anotar antes de subir dejaría lotes marcados como hechos sin estarlo")
})

test("nunca se sube un archivo cifrado a medias", () => {
  assert.match(MJS, /> \$\{tmp\}\.partial/)
  assert.match(MJS, /execFileSync\("mv", \["-f", `\$\{tmp\}\.partial`, tmp\]\)/)
})

test("por lotes, no archivo por archivo (son ~240k blobs)", () => {
  assert.match(MJS, /tar -cf - -C \$\{CAS\} \$\{p\.lote\}/)
})
