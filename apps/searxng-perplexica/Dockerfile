# SearXNG · Perplexica backend metasearch engine.
#
# Deployed as a Railway service (searxng-perplexica) queried privately by the
# Perplexica app over the internal network. The stock searxng/searxng image
# only emits HTML; Perplexica REQUIRES the JSON format, which can only be
# enabled via settings.yml — so we bake our own settings in.
FROM searxng/searxng:latest
COPY settings.yml /etc/searxng/settings.yml
