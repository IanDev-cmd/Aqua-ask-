# AquaAsk

OneAquaHealth IEEE Global Hackathon — AI search over OneAquaHealth publications.

- **Live:** https://aqua-ask.onrender.com
- **Code:** https://github.com/IanDev-cmd/Aqua-ask-

## Local

```bash
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

Open http://127.0.0.1:8001

## Render

On Render, startup loads `chroma_export.json.gz` (174 portable chunks + embeddings). The live `chroma_db/` folder is local-only — Windows HNSW binaries are not copied to Linux.

If the service was created from GitHub (not Blueprint), set **Start Command** to:

```bash
gunicorn your_application.wsgi --bind 0.0.0.0:$PORT --timeout 120
```
