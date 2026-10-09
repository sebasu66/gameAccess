# Client activation storage

The server returns `cacheable` on both activation redemption and status. It is true only for ordinary database-issued keys and false for private JSON courtesy keys. Missing policy is treated as nonpersistent.

- Ordinary Windows sessions and their entered key share one DPAPI-encrypted record under the current Windows account. The browser preview persists ordinary access in localStorage.
- Courtesy access uses only frontend and native process memory. The entered key is never passed to native storage. Any old activation file and pass-display metadata are removed when courtesy access is validated.
- Native provider requests obtain the same in-memory session through read_session, so courtesy access remains usable during the open app session.
- Closing/restarting the app requires courtesy users to re-enter their key.
- Legacy ordinary token-only records remain readable; their original key cannot be recovered, and My pass explains that instead of inventing a key.
- Expiry/revocation clears the saved key and token and hides My pass. Expiry display metadata for ordinary passes remains available to the login screen.

Deploy the updated API and rebuilt desktop client together. This policy cannot change storage behavior in already-installed older clients.
