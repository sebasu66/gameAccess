# Game Access 3D / XR Prototype

This branch is the experimental Godot 3D/social slice for Game Access. It includes XR support for Meta Quest 3, but **the 3D world and avatar system do not require XR**.

## Target

- Godot `4.7.1+`
- Desktop 3D mode
- Meta Quest 3 / OpenXR as an optional client mode
- Mobile renderer

When Godot 4.8 becomes available, this prototype should be tested and upgraded if compatibility is good.

## Architecture rule

The shared world owns rooms, players, avatars, screens, furniture, networking and spatial audio.

```text
Shared Game Access 3D world
├── PresenceAvatar3D      <- always available
├── Desktop player rig   <- keyboard/mouse/gamepad
└── XR player rig        <- optional OpenXR tracking
```

XR must remain an optional provider of head/hand tracking. It must never be a dependency of multiplayer presence or avatars.

## Avatar / Configura

The avatar module is documented in `avatar/README.md`.

Configura is the selected open-source customization framework. It is MIT licensed and pinned to upstream commit:

`0a7b08b74a5a7e684d3242cf3f1140cffed023cb`

Install it with:

```powershell
cd apps/xr-prototype
powershell -ExecutionPolicy Bypass -File .\setup-avatar.ps1
```

For local inspection of Configura's own sample assets, including Mii/simple-character examples:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-avatar.ps1 -IncludeExamples
```

Examples are omitted by default so they do not become production weight accidentally.

The current scene includes a very small built-in `PresenceAvatar3D` made from primitive meshes. It works without Configura and without OpenXR. Configura is an optional appearance/customization provider that can replace the fallback visual.

## XR dependencies

Pinned XR dependencies:

- Godot XR Tools `4.5.1`
- Godot OpenXR Vendors `5.1.0-stable`
- Godot Meta Toolkit `1.0.3-stable`

Install them with:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-xr.ps1
```

The XR installer keeps SHA-256 hashes pinned instead of committing large third-party binaries.

## First desktop smoke test

1. Run `setup-avatar.ps1`.
2. Open `project.godot` with Godot 4.7.1+.
3. Run the project without starting an OpenXR runtime.
4. The desktop camera must activate.
5. The sample `Game Access Player` avatar must be visible in the same 3D scene.

This proves the avatar/world path is independent of XR.

## First Quest 3 smoke test

1. Run `setup-avatar.ps1` and `setup-xr.ps1`.
2. Open the project in Godot 4.7.1+.
3. Start an OpenXR runtime or export to Quest 3.
4. The same shared scene and avatar must remain visible while the player rig switches to XR.

For standalone APK deployment the local machine still needs normal Godot Android tooling (Android build templates, SDK, JDK and Quest developer mode).

## Current avatar scope

The intended Game Access avatar is a lightweight presence avatar, not a realistic full-body character:

- low-poly torso
- simple/personalizable head
- optional hands
- idle / walking / sitting state
- head/look direction
- spatial voice source
- small expression channel

Future personalized heads generated from photos and webcam-driven expressions must plug into this avatar contract rather than replacing the multiplayer architecture.

## Next steps

1. Validate Configura under Godot 4.7.1 with `-IncludeExamples` locally.
2. Pick/create the final very-low-poly torso/head/hands assets.
3. Build a minimal Configura creator for only the appearance options Game Access needs.
4. Add idle/walk/sit animations.
5. Define compact multiplayer `PresenceState` replication and interpolation.
6. Route realtime voice to each avatar's `AudioStreamPlayer3D`.
7. Connect desktop look input.
8. Connect XR head/hands as optional richer tracking.
9. Later evaluate webcam facial-expression tracking and personalized heads from user photos.
10. Re-test the module on Godot 4.8 when upgrading the project.

Do not merge this experimental branch into `main` until desktop avatar and Quest smoke tests have both passed.
