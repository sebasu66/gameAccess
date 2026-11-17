# gameAccess desktop icon

`icon.svg` is the source: the maker's emblem of the opening's lock (a G and an A that make one circle, `SplashScreen.tsx`),
the G in the library's green and the A in the catalogue's orange glass, on the lock's dark round plate (Seba, 2026-10-30).

`icon.ico` (16, 24, 32, 48, 64 and 256 px) is the app's, the window's and the installer's icon. Before every Tauri
build `npm run prepare-icons` writes it again from `icon.ico.base64.txt`, so both change together. To make them again:

    inkscape src-tauri/icons/icon.svg --export-type=png --export-filename=icon-1024.png -w 1024 -h 1024
    npx tauri icon icon-1024.png -o <temp folder>
    copy <temp folder>/icon.ico here, write its base64 to icon.ico.base64.txt
    copy <temp folder>/128x128.png to public/brand/app-icon.png (the browser preview's tab)
