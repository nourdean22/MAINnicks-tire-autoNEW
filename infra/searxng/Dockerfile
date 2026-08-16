# searxng-perplexica · the metasearch backend Perplexica queries.
#
# This service ran for six weeks with NO source of truth: Railway reports
# `source = {image: null, repo: null}`, i.e. it was pushed once with `railway up`
# from a local directory that was never committed. This file reconstructs that
# build context from the running container (Void Linux, VERSION_STRING
# "2026.7.5+a6438586a", __SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml) so the
# config is reviewable and the service is redeployable.
#
# Pinned, not :latest — an unpinned metasearch image silently changes which
# engines exist, and engine availability is exactly what broke here.
FROM searxng/searxng:2026.7.5-a6438586a

COPY settings.yml /etc/searxng/settings.yml
