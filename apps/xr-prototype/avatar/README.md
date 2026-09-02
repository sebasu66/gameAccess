# Game Access Presence Avatar

This module defines the avatar used by the Game Access 3D multiplayer environment.

## Core rule

**Avatars do not depend on XR.**

Desktop, gamepad, keyboard/mouse, XR and future clients all use the same `PresenceAvatar3D`. XR only provides richer tracking data when it is available.

## Current avatar concept

The initial avatar is intentionally lightweight and presence-oriented rather than realistic:

- simple low-poly torso
- simple head
- optional left/right hands
- display name
- 3D voice anchor
- head/look orientation
- basic motion states: idle, walking, sitting
- normalized expression channel for future facial animation

The built-in primitive avatar is only a fallback/reference implementation. Configura is the selected customization framework for replacing it with modular meshes.

## Configura integration

Configura is MIT licensed and is installed by `../setup-avatar.ps1` from the pinned upstream commit:

`0a7b08b74a5a7e684d3242cf3f1140cffed023cb`

The setup script copies `addons/Configura` into this Godot project. By default it removes Configura's example assets to keep the runtime checkout small. For local evaluation of its sample characters (including its Mii/simple-character examples), run:

```powershell
.\setup-avatar.ps1 -IncludeExamples
```

Configura supports modular meshes, color/material customization, blendshapes, skeletal deformation and generated creator UI. Game Access should use only the subset needed for a small low-poly avatar.

`ConfiguraBridge` is optional and deliberately loaded dynamically. The base avatar scene parses and runs even when Configura is absent.

## Runtime structure

```text
PresenceAvatar3D
├── VisualRoot
│   ├── DefaultVisual       # always available, no addon required
│   └── CustomVisual        # Configura/custom generated character
├── LeftHandAnchor
├── RightHandAnchor
├── VoiceAnchor             # AudioStreamPlayer3D
└── NameLabel
```

## Input providers

The avatar must not know how tracking was produced. A client updates the same avatar contract from different providers:

```text
Desktop input ─┐
Gamepad input ─┼─> PresenceState ─> PresenceAvatar3D
XR tracking ───┤
Network state ─┘
```

Desktop can provide body position + look direction. XR can additionally provide tracked head and hand transforms.

## Multiplayer contract (planned)

Keep network state small. Do not replicate meshes or skeleton bones every frame.

Recommended presence payload:

```text
player_id
position
body_yaw
head_rotation
motion_state
left_hand_transform?   # optional / XR
right_hand_transform?  # optional / XR
expression_values      # small normalized values
speaking_level
avatar_appearance_id
```

Avatar appearance/configuration should be synchronized as an ID or compact serialized configuration, not by sending geometry.

## Spatial voice

Each avatar owns an `AudioStreamPlayer3D` at head height through `VoiceAnchor`. The network voice transport is separate from the avatar scene; decoded remote audio is routed to this node. This keeps positional audio identical for desktop and XR listeners.

## Planned customization

Initial customization should stay deliberately small:

- body color / simple clothing color
- a few torso variants
- head/face selection
- hair/accessory slots if inexpensive
- optional hand style

Avoid a large wardrobe or high-poly character system in the launcher.

## Future personalized head

The head is a replaceable slot. A future pipeline can use mobile/webcam photos to produce a recognizable stylized head or mask without replacing the body/avatar architecture.

Possible pipeline:

```text
photos -> facial feature extraction -> stylized head/texture -> HeadSlot
```

Prefer a shared low-poly topology plus morphs/materials over a unique heavy mesh per user.

## Future expressions / webcam

`PresenceAvatar3D.set_expression(name, weight)` is the stable input boundary. A future webcam tracker can map local facial observations into a small normalized set such as:

- blink
- smile
- mouth_open
- brow_up
- look_left/right

Only expression values should be transmitted; webcam video should not be required for multiplayer presence.

## Next steps

1. Test Configura under Godot 4.7.1 with the optional example assets.
2. Select or create the final low-poly torso/head/hands asset set.
3. Build a minimal Game Access creator using Configura: body color, torso, head and a few accessories only.
4. Add walking/idle/sitting animation to the low-poly body.
5. Define `PresenceState` serialization and interpolate remote avatars.
6. Route decoded voice into each avatar's `VoiceAnchor`.
7. Add XR tracking as an optional provider for head/hands.
8. Later add webcam expression tracking and personalized generated heads.

## Performance rule

The launcher/social environment must remain lightweight. Prefer few materials, low polygon counts, shared meshes/textures, LOD where useful, and compact network state. Avatar complexity must not compete with the 3D room, decorative models, video surfaces or a game running alongside Game Access.
