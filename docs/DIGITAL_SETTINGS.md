# Digital storage, library and launch settings

Game membership is independent from installation. Add to library persists a Steam AppID-based entry without downloading. Download also adds the game to the library. Uninstall deletes its files and transfer history but keeps membership. Remove from library uninstalls first and removes membership only on success. Clear library confirms removal of every member and is blocked during downloads. Failed removals remain in the library for retry.

The desktop stores membership in gameaccess.library.v1. Existing installed/downloaded games are migrated once. The catalog tab remains the complete game catalog; the Library tab shows saved membership, including uninstalled games.

Storage settings live in launcher/.cache/digital-settings.json. Defaults are launcher/games and launcher/.cache/digital_transfers. New downloads use an AppID-prefixed temporary folder and extract into an AppID-prefixed game folder. Retained archives remain with the game for the established pre-launch restoration. Changing paths applies to future downloads and records previous game roots so existing installations remain accessible. Changing paths does not move files. Uninstall also removes that game's partial temporary payload.

The detail/context menu exposes Language and launch. Language repair scans language keys in INI files and recognized language text files, preserves encoding and comments, and writes an original .gameaccess-language.bak once. It cannot install missing translations. Automatic pre-launch language fixes retain their established known-file scope and honor the selected language.

Advanced controls default to automatic executable detection, no extra arguments and no administrator elevation. An explicit executable must belong to the game's validated folder. Arguments are passed to the process without a command shell. Administrator mode uses the Windows runas verb and respects UAC cancellation. Archive restoration, OnlineFix preparation, existing executable detection and normal-launch diagnostics remain active.
