FROM python:3.12.8-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential g++ gcc libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHROMA_DIR=/app/chroma_db \
    PORT=10000

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN rm -rf /app/chroma_db \
    && python -c "from app import ENGINE; n = ENGINE.ensure_ready(); assert n > 0, n; print('linux chroma chunks', n)"

EXPOSE 10000
CMD ["python", "docker_entrypoint.py"]
