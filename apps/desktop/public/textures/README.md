# Textures

- `brushed-steel.jpg`: the device frame's metal (`DeviceFrame.tsx`). From ambientCG "Metal 009"
  (https://ambientcg.com/a/Metal009), Color map of the 1K-JPG package, CC0 1.0 (public domain, no attribution
  required). Converted to grey and its contrast raised (5×, around mid grey) so the brushing shows through the
  overlay blend.
- `glass-scratches.jpg`: scratches on the coloured glass of the lock's emblem (`SplashScreen.tsx`), blended with
  `screen` so its black is transparent. Supplied by Seba (2026-10-28); converted to grey.

- `stone.jpg`: rough rock, grayscale from ambientCG "Rock030" (1K Color map, CC0, https://ambientcg.com/a/Rock030). Tinted per deck in the genre decks (library-decks.css).
- `scratches.jpg`: scratches tile, ambientCG "Scratches005" (Opacity map, CC0). Over the deck cards.
- `scratches-dark.jpg`: `scratches.jpg` inverted (dark lines on white) for the dark layer; both 512 px and small on purpose (every deck card draws them).
