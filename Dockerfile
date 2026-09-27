# Cloud deploy (Render, Hugging Face Spaces "Docker" SDK, Railway, Fly...).
# The host injects PORT (Render: 10000, HF Spaces: 7860); the app binds to it.
# Optional env: SURYAJAL_DATA_DIR / SURYAJAL_CACHE_DIR -> a mounted persistent disk,
#               SURYAJAL_THREADS -> ONNX threads (auto = the container's CPU quota).
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=7860
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python scripts/download_models.py --strict
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
