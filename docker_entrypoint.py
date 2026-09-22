"""Linux/Render entrypoint: open the in-image Chroma index, then serve FastAPI."""
from __future__ import annotations

import os
import sys

from app import ENGINE


def main() -> None:
    chunks = ENGINE.ensure_ready()
    print(f"RAG ready chunks={chunks}", flush=True)
    os.execvp(
        "gunicorn",
        [
            "gunicorn",
            "-c",
            "gunicorn.conf.py",
            "your_application.wsgi",
        ],
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"entrypoint failed: {exc}", file=sys.stderr, flush=True)
        raise
