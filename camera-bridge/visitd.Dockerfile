FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VISITD_CONFIG=/config/config.yaml \
    VISITD_LEDGER=/data/visitd.sqlite

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY visitd ./visitd

RUN useradd --system --uid 10001 --create-home visitd \
    && mkdir -p /data /config \
    && chown -R visitd:visitd /data /config
USER visitd
VOLUME ["/data"]

CMD ["python", "-m", "visitd.main"]
