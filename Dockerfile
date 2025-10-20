FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN pip install --upgrade pip && pip install --no-cache-dir .
ENV PYTHONPATH=/app/src
EXPOSE 8000
CMD ["uvicorn", "dexter.server:app", "--host", "0.0.0.0", "--port", "8000"]
