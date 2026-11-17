# Pantalla grande

Activate with the expand icon in the footer, F11, or Start on a connected
standard-mapped controller. F11 / Start or the footer icon exits. Tauri enters
fullscreen and restores its previous fullscreen state on exit. If fullscreen
is unavailable, the enlarged layout still works in the window.

All visual rules remain in `apps/desktop/src/gameaccess-theme.css`.
The header uses locally bundled Xbox SVG prompts from Kenney (CC0), in
`apps/desktop/public/icons/xbox`; these do not require an internet connection.
The outer document stays within the viewport in this mode; the grid and
dialog content own scrolling, preventing a native scrollbar below the footer.

## Controls

- D-pad / left stick: select a game; directional focus inside dialogs.
- A / south button: open a game or activate the focused dialog control.
- B / east button: close the dialog, or exit large-screen mode from the grid.
- X / west button: on-screen search keyboard.
- Y / north button: filter dialog.
- LB / RB: Library / Catalog.
- LT / RT: scroll the grid or the detail/filter panel.
- Start: enter/exit large-screen mode.

The implementation uses the browser's standard Gamepad API mapping. Unknown
layouts are not guessed. Analog stick dead zone is 0.55; directions repeat
after 350 ms and every 150 ms thereafter. Accept/back only fire on press edges.
Input is suspended when the application loses focus or is hidden, and controller
state resets on disconnect. Controller names and device data are not persisted.

Keyboard selection uses the resolved CSS column tracks and the complete filtered
collection, including cards not rendered yet. Only a change of selected game
identity reveals a card. Metadata/favorite sorting keeps scroll in place.
Selection scrolling uses a cancellable cubic ease-out tween (220–380 ms), with
instant positioning for reduced-motion users. Wheel/touch/pointer input cancels it.

Validation: input timing/dead-zone tests, keyboard scrolling and favorite
reordering in an isolated browser fixture. Physical gamepad verification on
the packaged Windows client remains necessary.

Gamepad API reference: https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API
