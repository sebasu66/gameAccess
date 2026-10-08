# Activation entry review - 2026-10-08

The website remains paused while the desktop activation entry is reviewed.
The footer remains visible on activation and connection-wait screens.

## Implemented behavior

- Existing transparent G/A rotation is reused beside the form; reduced motion uses its poster.
- Connection retry replaces activation submission while the server is unavailable.
- Wake-up retries have no overall deadline. Individual network attempts are bounded
  and cancelled when a new verification starts or the component is replaced.
- Previous activation expiry/revocation is reported above the form, using server dates
  when available and cached expiry metadata as a fallback. Keys/tokens are never cached there.
- Rejection metadata only discloses dates for a matching token and installation.
  Revocation retains the token digest for this purpose, while revoked_at still denies access.
- BASE and PLUS offer copy is bilingual. Optional VITE_PLUS_CHECKOUT_URL links to
  an external checkout; without it, PLUS accurately shows availability pending.

## Existing key lifecycle

Admin issuance supports hour or calendar-month durations. Printable keys are returned
once and only digests are stored. Activation is bound to a UUID installation. Redeeming
again on that installation rotates the session token without extending its expiry.
Other installations, expired pending keys, expired sessions and revoked keys are rejected.
Protected server requests and play leases use the authoritative activation expiry.

Focused tests exercise the 12-hour lifecycle, repeat redemption, installation binding,
pending expiry, revocation, rejection metadata and expired protected HTTP requests.
Frontend tests exercise automatic recovery after 90 seconds and cancellation.

## External integration gaps requiring live configuration

Repository inspection found a configurable Linkvertise outbound URL and help content,
but no verified ad-completion callback or automatic ad-to-key issuance endpoint.
The existing generic admin key issuance is not proof of Linkvertise integration.

Linkvertise anti-bypass validation accepts a single-use hash for only 10 seconds:
https://publisher.linkvertise.com/documentations/Anti_Bypass_Documentation.pdf
A callback hosted on sleeping Render can miss that window. Warm the service before
starting the flow or use an available callback service, verify completion server-side,
and record a unique completion before issuing a 12-hour key. Three ads and one minute
are the requested offer; the actual provider flow still requires validation.

BASE/PLUS tiers, billing, seven-day trial enforcement, download concurrency and speed
limits are not currently represented by access-key plan metadata. The displayed offer
does not implement these server entitlements. Checkout and publisher URLs are optional
public configuration; publisher secrets must stay on the server.

Render free services may wake in about one minute and lose local SQLite changes on
sleep/restart/redeploy:
https://render.com/docs/free
render.yaml requests GAMEACCESS_DATABASE_URL, but live database persistence must be
verified from the service configuration. A free instance with local SQLite cannot
reliably preserve issued keys. Do not infer production persistence from local tests.

## Validation boundary

Local tests use isolated databases and synthetic keys, never live customer credentials.
A rebuilt desktop executable proves packaging and allows visual review. It does not
prove the hosted deployment, payment flow, ad completion or actual download-tier limits.
