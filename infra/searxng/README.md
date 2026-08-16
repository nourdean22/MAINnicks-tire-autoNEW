# searxng-perplexica

Internal metasearch backend. Perplexica reaches it at
`http://searxng-perplexica.railway.internal:8080` (`SEARXNG_API_URL`); statenour
reaches Perplexica. No public domain — deliberately.

## Deploy

```bash
railway up --service searxng-perplexica
```

Run it from **this directory**. Railway builds `/Dockerfile` relative to the
upload root, and the service has no linked GitHub repo — `railway up` from the
wrong directory is what would replace this image with something unrelated.

## Verifying a change

Engine reachability is a property of the egress IP, so it can only be measured
from inside the network, never asserted from a config file:

```bash
railway ssh --service perplexica -- sh   # then paste a fetch against /search
```

`unresponsive_engines` in the JSON response is the signal. `results: 0` with
HTTP 200 and a populated `unresponsive_engines` is the failure this config
exists to prevent.

## Windows / Git Bash gotchas

- `railway ssh -- sh -c '<script>'` **silently loses its quotes** and runs
  nothing. Pipe into a bare `sh` instead: `cat script.sh | railway ssh --service X -- sh`.
- Remote absolute paths get rewritten by MSYS (`/etc/searxng` becomes
  `C:/Program Files/Git/etc/searxng`). Export `MSYS_NO_PATHCONV=1` first.
