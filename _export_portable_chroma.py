"""Dump local Chroma docs+embeddings to a gzip JSON file (OS-portable)."""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import chromadb

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "chroma_db"
OUT = ROOT / "chroma_export.json.gz"
COLLECTION = "aquaask_kb"


def main() -> None:
    client = chromadb.PersistentClient(path=str(SRC))
    col = client.get_collection(COLLECTION)
    data = col.get(include=["documents", "metadatas", "embeddings"])
    ids = list(data.get("ids") or [])
    docs = list(data.get("documents") or [])
    metas = list(data.get("metadatas") or [])
    raw_emb = data.get("embeddings")
    embeddings = []
    if raw_emb is not None:
        for vec in raw_emb:
            embeddings.append([float(x) for x in list(vec)])
    if not ids or not docs or not embeddings or len(ids) != len(docs) or len(ids) != len(embeddings):
        raise SystemExit(
            f"Incomplete export: ids={len(ids)} docs={len(docs)} embeddings={len(embeddings)}"
        )
    payload = {
        "collection": COLLECTION,
        "ids": ids,
        "documents": docs,
        "metadatas": [dict(m or {}) for m in metas] if metas else [{} for _ in ids],
        "embeddings": embeddings,
    }
    with gzip.open(OUT, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    print(f"Wrote {OUT} chunks={len(ids)} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
