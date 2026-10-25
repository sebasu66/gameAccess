# Client activation storage

The server returns `cacheable` on both activation redemption and status. It is true only for ordinary database-issued keys and false for private JSON courtesy keys. Missing policy is treated as nonpersistent.

- Ordinary Windows sessions and their entered key share one DPAPI-encrypted record under the current Windows account. The browser preview persists ordinary access in localStorage.
- Courtesy access uses only frontend and native process memory. The entered key is never passed to native storage. Any old activation file and pass-display metadata are removed when courtesy access is validated.
- Native provider requests obtain the same in-memory session through read_session, so courtesy access remains usable during the open app session.
- Closing/restarting the app requires courtesy users to re-enter their key.
- Legacy ordinary token-only records remain readable; their original key cannot be recovered, and My pass explains that instead of inventing a key.
- Expiry/revocation clears the saved key and token and hides My pass. Expiry display metadata for ordinary passes remains available to the login screen.

Deploy the updated API and rebuilt desktop client together. This policy cannot change storage behavior in already-installed older clients.

## Access tier and manual PLUS payments

Both redemption and status expose access_tier (base or plus), supplied by the server. The frontend exposes getActivationTier() and activation change notifications for future feature controls. Ordinary monthly legacy keys migrate to PLUS; hourly legacy keys migrate to BASE. Private JSON courtesy entries may explicitly include access_tier; omitted values default to BASE.

The admin console issues keys with an explicit date/time and tier. Dates entered in the administrator's local timezone are sent as UTC instants. Existing duration-based API issuance remains compatible with the free ad flow; successful activation always has an absolute expiry.

After confirming a payment outside GameAccess, use the PLUS renewal form to extend the same key's expiry. The authenticated POST /admin/access-keys/{id}/renew endpoint rejects revoked keys, BASE keys, naive/past timestamps and dates that shorten the existing expiry. Renewing an expired PLUS key permits its holder to activate again using the same key. No payment provider integration or automatic payment detection is implied.

The active app rechecks status every minute, so renewals and tier changes reach the running client. Actual premium operations must enforce access_tier at their server boundary when those features are added.
