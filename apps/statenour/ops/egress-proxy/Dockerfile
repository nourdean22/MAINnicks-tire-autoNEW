# Egress proxy for the camofox scrape fallback: Stripe's Smokescreen, pinned.
# Setup and why: README.md here, and apps/statenour/docs/runbooks/camofox-scrape-fallback.md.
#
# Pins (read 2026-10-18): Smokescreen tag v0.1.0 = commit 609eb8931420453daf5893509be0b25b21bd9edb
# (MIT; go.mod `go 1.25.0`; vendor/ checked in, so the build needs no module download).
# Base images by digest, so a re-tag upstream cannot change what is built.
FROM golang:1.25-bookworm@sha256:c268a04d59aea0b180ed9946a658cfab9e7b3391dc90eed6e4969ccff98c851f AS build
ARG SMOKESCREEN_COMMIT=609eb8931420453daf5893509be0b25b21bd9edb
ENV GOTOOLCHAIN=local GOFLAGS=-mod=vendor CGO_ENABLED=0
RUN git clone --filter=blob:none https://github.com/stripe/smokescreen.git /src \
 && git -C /src checkout --detach "$SMOKESCREEN_COMMIT" \
 && test "$(git -C /src rev-parse HEAD)" = "$SMOKESCREEN_COMMIT"
WORKDIR /src
RUN go build -trimpath -o /out/smokescreen .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/smokescreen /smokescreen
EXPOSE 4750
# No --egress-acl-file: with no ACL every hostname is allowed (smokescreen.go:1329-1333 @v0.1.0),
# while every resolved address is still classified at dial time. Built-in denials (classifyAddr,
# smokescreen.go:302-331): self connections, non-global-unicast and loopback, RFC 1918 + fc00::/7
# (IsPrivate), CGNAT 100.64.0.0/10, IPv4-embedding IPv6. The --deny-range list repeats the ones
# that matter here and adds 0.0.0.0/8, 192.0.0.0/24, 198.18.0.0/15 and 240.0.0.0/4, which Go's
# IsGlobalUnicast does not exclude. No --listen-ip: the default is every interface, dual stack, so
# Railway's private network reaches it over IPv4 or IPv6. `--listen-ip=::` was tried live on
# 2026-10-18 and crash-looped: Smokescreen v0.1.0 joins ip and port as "%s:%d" with no brackets,
# so the address ":::4750" is rejected ("too many colons in address").
ENTRYPOINT ["/smokescreen", \
  "--listen-port=4750", "--timeout=10s", "--dns-timeout=5s", \
  "--max-concurrent-connect-tunnels=64", \
  "--deny-range=0.0.0.0/8", "--deny-range=100.64.0.0/10", "--deny-range=169.254.0.0/16", \
  "--deny-range=192.0.0.0/24", "--deny-range=198.18.0.0/15", "--deny-range=240.0.0.0/4", \
  "--deny-range=fc00::/7", "--deny-range=fe80::/10"]
