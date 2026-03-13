FROM python:3.12-slim

WORKDIR /workspace

RUN \
    apt update && \
    apt install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    nginx \
    ffmpeg && \
    pip install --no-cache-dir \
    fastapi uvicorn apscheduler httpx psutil docker && \
    rm -rf /var/lib/apt/lists/* && \
    apt clean
