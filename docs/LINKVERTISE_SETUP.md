# Linkvertise BASE pass setup

## What has been prepared

The API exposes:
- GET /activation/free/start - warms the API before opening the configured publisher link.
- GET /activation/free/return?hash=... - verifies the single-use provider confirmation and
  displays a unique 12-hour activation key once. The key must be activated within 24 hours.
  The clock starts on activation, not on the ad view.
- Failed, missing, forged, replayed and uncertain confirmations never generate a key.
  A retry must go through the ads again; refreshing the result page does not mint another.

The implementation is disabled until the publisher variables below are configured.
The desktop sends users to the server start page, so publisher URLs can be updated
without rebuilding the application.

## Publisher steps

1. Sign into your Linkvertise publisher account.
2. Create a Target Link with destination:
   https://gameaccess-api-dev.onrender.com/activation/free/return
   Use a Target Link, not a Paste Link or a shared text file of keys.
3. Locate the publisher anti-bypass setting and generate its authentication token.
   The token is a server secret. Do not put it in the desktop, public GitHub, a
   public URL or chat messages.
4. In Render, open gameaccess-api-dev > Environment. Add:
   GAMEACCESS_LINKVERTISE_URL = your published HTTPS linkvertise.com link
   GAMEACCESS_LINKVERTISE_ANTI_BYPASS_TOKEN = the generated token
5. First deploy the callback code to the dev branch used by Render. Confirm the
   callback endpoint exists before enabling anti-bypass, which affects all Target Links.
6. Enable anti-bypass in Linkvertise. It appends ?hash=... to the configured destination.
7. Test by starting at:
   https://gameaccess-api-dev.onrender.com/activation/free/start
   Complete the provider steps, receive a fresh key, activate it on a test installation,
   and check its twelve-hour expiry. Refreshing the result must not issue another key.
8. Record the tutorial only after this complete path works. Set the optional
   VITE_LINKVERTISE_HELP_VIDEO_URL to the public tutorial video when it is ready.

The exact dashboard labels may differ; follow the publisher's current settings.
Official protocol:
https://publisher.linkvertise.com/documentations/Anti_Bypass_Documentation.pdf

## Sleeping-server constraint

The provider hash lasts only ten seconds and is consumed by successful validation.
Render free wake-up can take about one minute:
https://render.com/docs/free

The start route wakes the server before the ad flow; it cannot guarantee readiness
if the user leaves the provider page open long enough for the server to sleep again.
For dependable public operation, put the callback on an always-available service
or move the API to an instance that stays awake. A late callback must fail safely
and invite a new attempt; it must never assume that ads were completed.

The displayed three ads / approximately one minute is the requested offer.
Verify the actual publisher experience before recording or promoting this wording;
the anti-bypass protocol confirms a provider ad step, not a guaranteed ad count.

## PLUS through manual payment confirmation

Use your approved bank-transfer or Mercado Pago payment-request details outside
GameAccess for the initial beta. Do not mark an access as paid from a browser return,
a screenshot or an unverified customer message. Confirm receipt in your own account.

After confirmed payment, the existing authenticated admin key issuer can create:
- monthly access: duration_months=1
- one-week trial: duration_hours=168

Deliver the generated key privately by email. The current generic key system does
not yet tag PLUS subscribers or enforce a single trial per person. Manual trial
approval is required until subscriber identity and entitlement rules are implemented.
BASE versus PLUS download concurrency/speed also requires server/client enforcement.

A public payment instructions/contact URL can be placed in VITE_PLUS_CHECKOUT_URL.
No automatic checkout, payment notification or email delivery is claimed by this change.
