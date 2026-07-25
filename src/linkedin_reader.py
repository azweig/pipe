# LinkedIn reader (no oficial, vía cookie de sesión) — LECTURA de mensajes + búsqueda de perfiles.
# Cubre: mensajería (→ data/messages.jsonl como channel "linkedin") y perfiles (modo profile, para enrichment).
# Cookies en auth/linkedin-cookies.json: {"li_at":"...","JSESSIONID":"ajax:...","email":"(opcional)"}
# Uso:  python src/linkedin_reader.py           (loop: lee mensajes cada 60s)
#       python src/linkedin_reader.py profile "Nombre Apellido"   (busca perfil)
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COOKIES = os.path.join(ROOT, "auth", "linkedin-cookies.json")
STATE = os.path.join(ROOT, "auth", "linkedin.state.json")
STORE = os.path.join(ROOT, "data", "messages.jsonl")

SKIP_KEYS = {"email", "password"}

def cookie_jar():
    from requests.cookies import RequestsCookieJar
    c = json.load(open(COOKIES))
    jar = RequestsCookieJar()
    for k, v in c.items():
        if k in SKIP_KEYS or not v: continue
        val = str(v)
        if k == "JSESSIONID" and not val.startswith('"'): val = '"%s"' % val  # JSESSIONID va con comillas
        jar.set(k, val, domain=".linkedin.com")
    return jar

def load_api():
    from linkedin_api import Linkedin
    c = json.load(open(COOKIES))
    return Linkedin(c.get("email", ""), c.get("password", ""), cookies=cookie_jar())

def dig_text(ev):
    try:
        ec = ev["eventContent"]["com.linkedin.voyager.messaging.event.MessageEvent"]
        return (ec.get("attributedBody", {}) or {}).get("text") or ec.get("body") or ""
    except Exception:
        return ""

def dig_from(ev):
    try:
        mp = ev["from"]["com.linkedin.voyager.messaging.MessagingMember"]["miniProfile"]
        return ("%s %s" % (mp.get("firstName", ""), mp.get("lastName", ""))).strip() or "?"
    except Exception:
        return "?"

def append(rec):
    with open(STORE, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def poll(api, seen):
    n = 0
    convs = api.get_conversations().get("elements", [])
    for c in convs:
        cid = (c.get("entityUrn", "") or "").split(":")[-1]
        if not cid: continue
        try:
            evs = api.get_conversation(cid).get("elements", [])
        except Exception:
            continue
        for ev in evs:
            mid = ev.get("entityUrn", "") or ev.get("dashEntityUrn", "")
            if not mid or mid in seen: continue
            seen.add(mid)
            text = dig_text(ev)
            if not text: continue
            rec = {"channel": "linkedin", "account": "linkedin", "jid": cid,
                   "name": dig_from(ev), "text": text, "ts": ev.get("createdAt", int(time.time() * 1000))}
            append(rec); n += 1
            print("💬 [linkedin] %s: %s" % (rec["name"], text[:80]), flush=True)
    return n

def profile_mode(query):
    api = load_api()
    res = api.search_people(keywords=query, limit=1)
    if not res:
        print(json.dumps({"found": False})); return
    p = res[0]
    out = {"found": True, "name": p.get("name"), "public_id": p.get("public_id"),
           "jobtitle": p.get("jobtitle"), "location": p.get("location")}
    if p.get("public_id"):
        try:
            prof = api.get_profile(p.get("public_id"))
            out.update({"headline": prof.get("headline"), "location": prof.get("locationName"),
                        "industry": prof.get("industryName"),
                        "experience": [{"title": e.get("title"), "company": e.get("companyName")} for e in (prof.get("experience", [])[:3])]})
        except Exception:
            pass
    print(json.dumps(out, ensure_ascii=False))

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "profile":
        profile_mode(" ".join(sys.argv[2:])); return
    # loop de mensajería — espera cookies sin crashear
    while not os.path.exists(COOKIES):
        print("⏳ [linkedin] esperando auth/linkedin-cookies.json ...", flush=True)
        time.sleep(30)
    api = load_api()
    print("✅ [linkedin] CONECTADO (perfiles OK) — intentando mensajería...", flush=True)
    seen = set(json.load(open(STATE))) if os.path.exists(STATE) else set()
    fails = 0
    while True:
        try:
            poll(api, seen)
            json.dump(list(seen), open(STATE, "w"))
            fails = 0
            time.sleep(60)
        except Exception as e:
            fails += 1
            if fails <= 2:
                print("[linkedin] mensajería no disponible (%s) — reintentos espaciados" % str(e)[:60], flush=True)
            time.sleep(min(300 * fails, 1800))  # backoff: la mensajería no-oficial es frágil

if __name__ == "__main__":
    main()
