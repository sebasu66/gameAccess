# Cyberpunk trailer screen media

The 3D showroom uses Hap Video v0.3.0 through `HapPlayer`.

- Video: `user://media/cyberpunk_ultimate_edition_trailer_1440p_hap1.mov`
- Audio: `res://assets/media/cyberpunk_ultimate_edition_trailer_audio.ogg`
- Source: CD PROJEKT RED, *Cyberpunk 2077: Ultimate Edition — Official Launch Trailer*
  (`https://www.youtube.com/watch?v=Ugb80d5lxEM`)

The 2560x1440 Hap1 MOV intentionally lives under `user://media` rather than
`res://`, following the addon's recommendation not to pack gigabyte-scale Hap
files into the exported PCK. Hap Video is video-only, so the synchronized
Vorbis audio is a separate Godot resource routed through the `TVRoom` bus.

The screen implementation uses the addon's asynchronous `HapPlayer` path and
binds `HapPlayer.get_texture()` directly to a spatial shader after `opened`.
It does not use a `SubViewport` or the synchronous `.mov` resource loader.
