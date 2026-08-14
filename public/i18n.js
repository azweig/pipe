// i18n del PWA — traducción en runtime, SIN tocar los ~373 call-sites de app.js.
//
// El ESPAÑOL es la fuente: en el código las cadenas se escriben en español y acá se traducen sobre el DOM. Eso permite sumar
// idiomas sin refactorizar la app entera, y es el mismo motor que usa la app de escritorio (comparten los diccionarios).
//
// Cada idioma vive en /i18n/<lang>.js y expone { MAP, RULES } bajo window.PIPE_I18N.<lang>:
//   MAP   = texto exacto tal como aparece en la interfaz  ("Bandeja" → "Inbox")
//   RULES = pares [regex, reemplazo] para lo interpolado   (/^Hoy, (\d+)$/ → "Today, $1")
// El diccionario se descarga SOLO para el idioma en uso: sumar idiomas no engorda la carga de nadie.
//
// Una cadena sin traducir cae en español. Es un fallback deliberado: mejor español legible que un hueco.
(function () {
  "use strict"
  // SOLO los idiomas que TIENEN diccionario en /i18n/. Ofrecer los 7 de pipe.one era prometer de más: elegir Deutsch
  // recargaba, el import de /i18n/de.js caía en el fallback SPA (200 con index.html → falla el parse) y la app quedaba
  // ENTERA en español con el selector marcando alemán. Agregar un idioma = sumar su archivo y sumarlo acá.
  var LANGS = ["es", "en", "pt"]
  var NAMES = { es: "Español", en: "English", pt: "Português", fr: "Français", de: "Deutsch", zh: "中文", ja: "日本語" }
  var LANG = (function () {
    try { var s = localStorage.getItem("lang"); if (LANGS.indexOf(s) >= 0) return s } catch (e) {}
    try { var n = (navigator.language || "es").slice(0, 2).toLowerCase(); return LANGS.indexOf(n) >= 0 ? n : "es" } catch (e) { return "es" }
  })()
  window.PIPE_LANG = LANG
  window.PIPE_LANGS = LANGS
  window.PIPE_LANG_NAMES = NAMES
  window.setLang = function (l) { try { localStorage.setItem("lang", l) } catch (e) {} location.reload() }

  try { document.documentElement.lang = LANG } catch (e) {}
  if (LANG === "es") return // español = fuente, no hay nada que traducir

  var MAP = {}, RULES = []

  function trStr(raw) {
    var key = raw.trim(); if (!key) return null
    if (MAP[key]) return raw.replace(key, MAP[key])
    for (var i = 0; i < RULES.length; i++) { if (RULES[i][0].test(key)) { var out = key.replace(RULES[i][0], RULES[i][1]); if (out !== key) return raw.replace(key, out) } }
    return null
  }

  var ATTRS = ["placeholder", "title", "aria-label", "alt"]
  function trEl(el) {
    if (el.nodeType === 1) {
      for (var a = 0; a < ATTRS.length; a++) { if (el.hasAttribute && el.hasAttribute(ATTRS[a])) { var v = el.getAttribute(ATTRS[a]); var t = v && MAP[v.trim()] ? v.replace(v.trim(), MAP[v.trim()]) : null; if (t) el.setAttribute(ATTRS[a], t) } }
    }
  }
  function walk(node) {
    if (!node) return
    if (node.nodeType === 3) { var t = trStr(node.nodeValue); if (t != null) node.nodeValue = t; return }
    if (node.nodeType !== 1) return
    if (node.tagName === "SCRIPT" || node.tagName === "STYLE" || node.tagName === "SVG" || node.tagName === "PATH") return
    trEl(node)
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c)
  }

  function run(root) { try { walk(root || document.body) } catch (e) {} }
  // observar TODO cambio del DOM (render() central + innerHTML sueltos)
  function observe() {
    try {
      var obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i]
          if (m.type === "childList") { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]) }
          else if (m.type === "characterData") { var t = trStr(m.target.nodeValue); if (t != null && t !== m.target.nodeValue) m.target.nodeValue = t }
        }
      })
      obs.observe(document.body, { childList: true, subtree: true, characterData: true })
    } catch (e) {}
  }

  function start(d) {
    if (!d) return // sin diccionario (idioma aún sin traducir) → la app queda en español, que es legible
    MAP = d.MAP || {}; RULES = d.RULES || []
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { run(); observe() })
    else { run(); observe() }
  }

  // El diccionario se descarga aparte (solo el del idioma en uso) y como MÓDULO: el mismo archivo lo importa la app de
  // escritorio, así una sola traducción sirve para las dos. Si falla, no rompe nada: queda el español.
  import("/i18n/" + LANG + ".js").then(function (m) { start(m && m.default) }, function () { /* idioma sin traducir todavía */ })
})()
