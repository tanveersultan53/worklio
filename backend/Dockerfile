FROM python:3.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# Dev images (docker-compose.yml) install test tools; production builds pass EXTRAS="".
ARG EXTRAS=dev
COPY pyproject.toml .
RUN mkdir app && touch app/__init__.py \
    && pip install -e ".${EXTRAS:+[$EXTRAS]}"
COPY . .

RUN useradd --system --uid 10001 --home /app worklio && chown -R worklio /app
USER worklio

EXPOSE 8000
# Production entrypoint. Behind a reverse proxy, --proxy-headers makes client IPs (rate limits)
# and https scheme detection correct. WEB_CONCURRENCY sets the worker count.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_CONCURRENCY:-2}"]
