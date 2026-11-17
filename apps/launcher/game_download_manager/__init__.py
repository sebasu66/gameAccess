"""Game Download Manager: everything between 'the user pressed Download' and 'the files are on disk'.

    worker.py             the command-line worker the app starts (progress, pause/cancel, status files)
    queue_manager.py      the download queue: which downloads run, wait, pause or resume (BASE 1, PLUS 4)
    queue_service.py      the Download Manager process the app starts: owns the queue and the workers
    pipeline.py           transfer -> unpack -> hand the folder to the Game Execution Manager
    http_transport.py     direct links (chunked, resumable)
    torrent_transport.py  torrents and magnets
    route_decision.py     PLUS: download a torrent directly or ask the server for it
    chunked.py            PLUS: the server's TorBox -> ViKiNG pieces, downloaded as they arrive
    source_validation.py  what a download source may look like
    extractor.py          7-Zip / zip / tar extraction and archive cleanup
    unpack.py             quiet extraction for callers outside a download (injected into the other managers)
    reconciliation.py     cleaning up finished or abandoned transfers
    context.py            state shared by one running download
"""
