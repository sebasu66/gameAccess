# Steam account/license archive

The earlier implementation is preserved on GitHub branch
`codex/legacy-steam-licenses`, at commit
`038115c1830a4e802c5031f2379310653683c525` before removal.

That branch contains provider-account rosters, Steam credentials, license/family
inventories, rental leases, credit charges, account switching/restoration and
provider-authenticated depot download workflows. Future work on those concepts
belongs on that branch and must not be reintroduced into this library-manager version.

The current product has library membership, Steam discovery metadata, user-supplied
source plugins, torrent/file download queues, installation and game execution.
BASE/PLUS keys activate GameAccess itself; they never represent Steam ownership.
Public Steam Store metadata and existing installed-game manifests can still be read.
Launching an already-installed Steam game sends its launch URI without changing
accounts or performing an ownership/login operation.

Existing private credential files, old databases, installed games and downloads
on the user's PC are preserved. Removing source does not purge user data. Installer
staging removes only obsolete Python module files from its runtime root and retains
the Digital installation registry and game subdirectories.
