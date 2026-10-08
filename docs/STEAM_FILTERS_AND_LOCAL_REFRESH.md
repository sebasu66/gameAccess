# Steam filters and local refresh

The desktop filter overlay groups **genres**, **players**, **play style**,
**connection**, and **features**. Choices are independent checkboxes; a game can
support single-player, co-op, PvP, local play, LAN and online simultaneously.

- Multiple selections within a group mean **OR**. Genres always use OR.
- Different groups narrow results together.
- Specific combinations use explicit capabilities: Online Co-op plus LAN PvP
  does not confirm LAN Co-op. Screen support and LAN support can be separate
  supported modes in the same game.
- Missing child capabilities mean unknown for a generic multiplayer record.
  The default **include incomplete information** toggle retains possible matches.
- Known different genres and positively identified solo-only games are excluded
  from incompatible searches. PvE can apply to single-player games too.
- Community tags may be searched as text, but do not confirm capabilities.
- Favorites retain global priority, then confirmed matches precede possible
  matches, then the selected catalog sort applies.

SteamDB comparisons use identical AppIDs and capability categories, not global
result totals or community tags. `libraryFilterLogic.test.ts` records checked
examples for Portal 2, Stardew Valley and Counter-Strike 2, plus an explicit
LAN PvP/Online Co-op combination regression. Category IDs from local Steam data
are retained to avoid depending solely on translated labels.

## Background worker

`steam_metadata_worker.rs` runs one native thread while the desktop app is open.
It visits all loaded catalog AppIDs, skips a fresh 24-hour Store/review cache,
and fetches one game at a time. Successful requests are spaced five seconds
apart; network/review errors back off five minutes. The queue retries on later
passes and resumes from the cache across client restarts. It runs when minimized
and exits with the client; no scheduled task or separate server is required.

Before a network refresh, it checks Steam's registry running-game flags and
executable processes inside known Steam/Digital installation directories.
Detection failures pause the worker. A game starting during a request lets that
in-flight request finish, then prevents new requests at the next activity check.
Games installed outside the known roots by other launchers require additional
installation-root integration to be detected reliably.

Full Store metadata and review summaries live under
`%LOCALAPPDATA%/gameAccess/media-cache/steam-<AppID>.json`. Compact projections
update the grid's genres, capabilities, release dates and ratings, preserving
catalog IDs and installation commands. Full descriptions/media are read when
details open. Neither metadata enrichment nor caching grants installation or
play access. Steam storage requirements are not download or installed sizes.

All visual rules remain in the commented `gameaccess-theme.css` file.
