# LiteLLM sa našom konfiguracijom ugrađenom u sliku (bez kačenja fajlova — radi isto u Coolify-ju i ručno).
FROM ghcr.io/berriai/litellm:main-stable
COPY infra/litellm.config.yaml /app/config.yaml
