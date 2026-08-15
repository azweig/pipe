#!/usr/bin/env bash
# Cifrado de los backups de tenants. Se usa desde deprovision.sh y tenants.sh.
#
# Por qué existe: los dos hacían `tar -czf` en claro de `data auth vault`. Ahí adentro va TODO lo que protege el sistema:
# los mensajes, los tokens de las cuentas conectadas, el hash del 2º PIN y las notas apartadas por ser de una cuenta
# secreta. Un backup en claro en /opt/tenant-backups es la copia sin candado de todo eso — y de VARIOS clientes juntos,
# en una caja compartida.
#
# ES LA MISMA RECETA QUE scripts/backup.sh, a propósito y hasta en los detalles. Ese archivo ya se comió los errores que
# hay que no cometer, y están documentados ahí:
#   · tolerar `tar` con salida 1 ("file changed as we read it"): sobre directorios VIVOS es lo normal, y el archivo queda
#     válido igual. Tratarlo como fatal dejó al hub 4 días sin backup en su momento.
#   · exigir en cambio que openssl salga 0 (eso sí es fatal), mirando PIPESTATUS y no el exit de la tubería.
#   · pasar la passphrase por ARCHIVO, nunca en la línea de comandos: el argv de un proceso lo lee cualquiera con `ps`,
#     y todo el punto de esto es protegerse de los otros usuarios de la caja.
#   · -md sha512, para que un archivo de acá se descifre con el mismo comando que uno de allá.

# Directorio de backups. Overrideable para poder probar sin tocar /opt.
DIR_BACKUPS="${TENANT_BACKUPS_DIR:-/opt/tenant-backups}"

# Devuelve la RUTA del archivo de passphrase (no su contenido: así nunca pasa por una variable ni por el argv).
# FAIL-CLOSED: si ya hay backups cifrados y el archivo no está, se corta. Regenerarlo en silencio convertiría todos los
# backups viejos en basura indescifrable sin que nadie se entere — que es peor que no tener backup, porque parece que sí.
pass_backups() {
  local dir="${1:-$DIR_BACKUPS}"
  local f="$dir/.pass"
  mkdir -p "$dir"; chmod 700 "$dir" 2>/dev/null || true
  if [ ! -s "$f" ]; then
    if ls "$dir"/*.tar.gz.enc >/dev/null 2>&1; then
      echo "❌ Falta $dir/.pass pero YA HAY backups cifrados: sin esa passphrase no se pueden restaurar." >&2
      echo "   Recuperá el archivo de donde lo hayas guardado. NO genero una nueva (dejaría los backups viejos inservibles)." >&2
      return 1
    fi
    # noclobber: si dos corridas simultáneas llegan acá, una sola crea el archivo y la otra usa el que quedó.
    ( set -o noclobber; umask 077; openssl rand -base64 48 > "$f" ) 2>/dev/null || true
    chmod 600 "$f" 2>/dev/null || true
    [ -s "$f" ] || { echo "❌ no pude crear $f" >&2; return 1; }
    echo "🔑 Passphrase de backups creada en $f — GUARDALA APARTE: sin ella no se puede restaurar nada." >&2
  fi
  printf '%s' "$f"
}

# cifrar_tar <salida.tar.gz.enc> <ruta-del-.pass> -- <args de tar…>
# tar → gzip → openssl por tubería: el .tar.gz en claro nunca toca el disco. Escribe a .partial y renombra al final,
# así un backup truncado nunca queda con el nombre definitivo (que es el que elegiría un restore).
cifrar_tar() {
  local out="$1"; shift
  local passfile="$1"; shift
  [ "$1" = "--" ] && shift
  local tmp="$out.partial"
  local rc
  set +e
  tar -czf - "$@" 2>/dev/null \
    | openssl enc -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -salt -pass file:"$passfile" > "$tmp"
  rc=("${PIPESTATUS[@]}") # (tar openssl)
  set -e
  # tar=1 es tolerable (archivo vivo que cambió mientras se leía); openssl=0 es obligatorio.
  if { [ "${rc[0]}" -eq 0 ] || [ "${rc[0]}" -eq 1 ]; } && [ "${rc[1]}" -eq 0 ]; then
    mv -f "$tmp" "$out"
    chmod 600 "$out"
    return 0
  fi
  rm -f "$tmp"
  echo "❌ backup FALLÓ para $out (tar=${rc[0]} openssl=${rc[1]})" >&2
  return 1
}

# limpia los .partial que hayan quedado de una corrida muerta a mitad (kill/OOM/corte). La rotación no los ve — matchea
# el nombre final — así que sin esto se acumulan para siempre, y son del tamaño del backup.
limpiar_partials() { rm -f "${1:-$DIR_BACKUPS}"/*.partial 2>/dev/null || true; }

# para el README/mensajes: cómo se restaura
receta_restore() {
  echo "   restore:  openssl enc -d -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -pass file:${DIR_BACKUPS}/.pass -in <archivo>.enc | tar -xzf - -C <destino>"
}
