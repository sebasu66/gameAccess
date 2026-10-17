"""Game Download Manager: everything between 'the user pressed Download' and 'the files are on disk'.

    worker.py             the command-line worker the app starts (progress, pause/cancel, status files)
    pipeline.py           transfer -> unpack -> hand the folder to the Game Execution Manager
    http_transport.py     direct links (chunked, resumable)      chunked.py: parallel ranges
    torrent_transport.py  torrents and magnets
    debrid.py             Torbox client
    source_validation.py  what a download source may look like
    extractor.py          7-Zip / zip / tar extraction and archive cleanup
    unpack.py             quiet extraction for callers outside a download (injected into the other managers)
    reconciliation.py     cleaning up finished or abandoned transfers
    context.py            state shared by one running download
"""
