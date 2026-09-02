# Game Access XR Prototype — Meta Quest 3

This isolated Godot project is the first XR vertical slice for Game Access. It is intentionally separate from the current Tauri desktop app so XR can be validated without destabilizing the main product.

## Target

- Godot 4.6 or newer
- Meta Quest 3
- OpenXR
- Mobile renderer

## Pinned dependencies

- Godot XR Tools `4.5.1`
- Godot OpenXR Vendors `5.1.0-stable`
- Godot Meta Toolkit `1.0.3-stable`

The repository keeps a reproducible installer rather than committing large third-party binaries. SHA-256 hashes are pinned in `setup-xr.ps1`.

## Install XR dependencies

From PowerShell:

```powershell
cd apps/xr-prototype
powershell -ExecutionPolicy Bypass -File .\setup-xr.ps1
```

This populates `apps/xr-prototype/addons/` with the three pinned XR addons.

## First smoke test

1. Open `apps/xr-prototype/project.godot` with Godot 4.6+.
2. Let Godot import the addons.
3. Run the project.
4. With an OpenXR runtime available, the viewport switches to XR automatically.
5. Without a runtime, the project stays usable in a desktop diagnostic fallback and shows that OpenXR was not detected.

The minimal scene already contains:

- `XROrigin3D`
- `XRCamera3D`
- left `XRController3D`
- right `XRController3D`
- a simple floor and reference cube
- OpenXR initialization and desktop fallback

## Quest 3 standalone test

For standalone APK deployment, the local machine still needs the normal Godot Android toolchain:

- Godot Android build templates
- Android SDK
- JDK 17
- USB debugging / developer mode enabled on the Quest 3

After dependency setup, use the OpenXR Vendors project setup/export tooling inside Godot to configure the Android/Meta export preset. Do not commit machine-specific SDK paths or signing credentials.

## Architecture rule

The XR player is a client/view/controller for the same Game Access room model. The future room/world scene must not be duplicated for VR. Desktop and XR player rigs should coexist over the same shared world and networking contracts.

## Next implementation slice

After the first headset smoke test succeeds:

1. Add XR Tools locomotion and teleport.
2. Add grab/interact affordances.
3. Replace the placeholder room with the Game Access 3D room prototype.
4. Wire shared room/presence state.
5. Add synchronized screen/video interaction.
6. Evaluate hand tracking and passthrough on Quest 3.

Do not merge this branch into `main` until the headset smoke test is successful.
