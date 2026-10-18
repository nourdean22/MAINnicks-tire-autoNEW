# egress-proxy (Smokescreen)

The only way camofox-browser reaches the internet. Every request the browser makes, the page itself included, goes
through this proxy, which resolves the hostname itself and refuses any address that is not publicly routable. That
closes the DNS-rebinding gap that statenour's own URL check cannot close, because statenour never opens those
connections itself.

- **Software:** Stripe's Smokescreen, an HTTP CONNECT proxy (MIT), tag v0.1.0 at commit
  `609eb8931420453daf5893509be0b25b21bd9edb`, built by `Dockerfile` here. No moving refs.
- **Policy:** no hostname ACL (all public hosts allowed), plus the address denials listed in the `Dockerfile`
  comment. Plain `http://` requests go through the same dialer as CONNECT (`proxy.Tr.DialContext = dialContext`,
  smokescreen.go:736 @v0.1.0), so both are filtered.
- **No authentication.** Smokescreen identifies clients only by mTLS certificate (its README, "Client
  Identification"), and with no ACL it never asks who the client is. Access is limited by placement: private
  networking only, no public domain, inside the camofox project. Leave camofox's `PROXY_USERNAME` /
  `PROXY_PASSWORD` unset.
- **Deploy:** a Railway service from this repo with Root Directory `apps/statenour/ops/egress-proxy`. Steps:
  `apps/statenour/docs/runbooks/camofox-scrape-fallback.md`. Nothing in the repo runs it.
- **Upgrade:** change `SMOKESCREEN_COMMIT` and the base image digests in one reviewed PR after reading the diff.

NOT CHECKED: the image build and live proxy behaviour (no Docker on the authoring machine).
