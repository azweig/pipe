import os, tempfile
from fastapi import FastAPI, UploadFile, File, Header, HTTPException
from faster_whisper import WhisperModel
TOKEN = os.environ.get("WHISPER_TOKEN", "")
MODEL = os.environ.get("WHISPER_MODEL", "base")
_m = None
def model():
    global _m
    if _m is None: _m = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=int(os.environ.get("WHISPER_THREADS","8")))
    return _m
app = FastAPI()
@app.get("/health")
def health(): return {"ok": True, "model": MODEL}
@app.post("/stt")
async def stt(file: UploadFile = File(...), language: str = "es", authorization: str = Header(None)):
    if TOKEN and authorization != f"Bearer {TOKEN}": raise HTTPException(401, "unauthorized")
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        f.write(data); f.flush()
        segs, info = model().transcribe(f.name, language=(language or None), beam_size=1, vad_filter=True)
        return {"text": "".join(s.text for s in segs).strip(), "lang": getattr(info, "language", None)}
