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

## Render (Linux Docker RAG)

`render.yaml` builds a **Linux gcc** image. During `docker build` it loads `chroma_export.json.gz` and writes a native `/app/chroma_db` HNSW index (not the Windows folder). Set `GOOGLE_API_KEY` and `XAI_API_KEY` in the dashboard.

If the current service is still “Python native”, switch it to **Docker** and point at this Dockerfile, or create a new Blueprint from the repo.
