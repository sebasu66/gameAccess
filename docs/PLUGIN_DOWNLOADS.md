# Plugin download contract

## Current product contract (2026-10-09)

GameAccess is a game library manager, searchable metadata catalog and generic torrent/file download manager. It does not supply Steam provider licenses or bundle/distribute third-party download lists. Users configure external source-provider plugins; those plugins own their source configuration and return download options. Legacy provider/lease code below is historical and does not define the current product.

BASE allows one active download and PLUS up to four. Both have the same catalog, placements, actions and persistent download queue. PLUS accelerated downloads through an internal debrid service and a Viking Files cache remain unimplemented; do not advertise them as working.

The default Download action uses the plugin's first ranked option. Its label retains that option's declared package size and shows the available option count in square brackets. More options (three dots) exposes alternative versions/sources. Source availability and named-source filters are derived from plugins, never embedded catalog links, Steam disk requirements or license capacity. Filter groups are collapsed by default.


The application reads source_provider manifests registered in the user's GameAccess/plugins folder.
GET /api/sources?app_id=<Steam AppID>&name=<game name> returns an array of {title,url,type,size,score,sourceName?}. Only magnet and HTTP(S) URLs are accepted. Size belongs to the returned URL; score orders options and is not proof of connectivity.
POST /api/bulk_check receives {games:[{id,name}],include_sources:true}. Existing numeric counts remain supported and use the provider's manifest name. For named feed filters, providers may return {<AppID>:{count:number,sources:string[]}}. The bundled example requests no source lists until the user configures them externally.
The server's /library/catalog endpoint supplies metadata without leases, source URLs or package sizes. Legacy source admin data is retained for migration; the current client does not consume it.

The UI refreshes sources periodically and on focus, updates React state immutably, and rejects stale detail results. A failed plugin contributes no current availability. Source choice is explicit in the queued record; default and alternative downloads use the same durable service.
Changing tiers changes admission of queued jobs. Already running jobs are preserved when the limit decreases; no new job starts until the active count fits the new limit.

Source discovery, provider HTTP outcomes, usable options, queue admission, phase transitions and terminal slot release use the existing narration log. Extraction and executable selection add AppID context to the existing worker logs. These logging additions do not change installation or launch policy, and do not record source URL query tokens or passwords.

Bulk availability is published after each batch so named-source filters and download indicators become useful before the entire metadata catalog has been scanned.
