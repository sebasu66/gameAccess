# Godot 3D implementation plan

## Direction

GameAccess is moving toward a native Windows 3D client. Godot owns the world, camera, interaction, lighting, audio and room presentation. The existing React 2D application remains the library/settings surface and will first appear in-world through a tablet/terminal surface. Steam and backend operations stay behind the existing local/service boundaries.

## Room model

Each room is a data record with an id, kind, transform, dimensions, visual theme and expansion slots. Content is instantiated from reusable room items rather than hard-coded into the application flow.

### Community hall

- Shared public space for discovery, presence, social video and game showcases.
- First layout: 22 m × 14 m, lounge island, arcade row, game showcase wall and social screen.
- Expansion points on north, east and south boundaries.
- Future modules: cinema/lounge, tournament area, event stage, additional arcade wings and social booths.

### Private room

- User-owned space with private furniture, game displays, desk/terminal and personal media.
- First layout: 10 m × 8 m.
- Expansion points on all boundaries.
- Future modules: extra wall bays, collections room, streaming booth, workshop and customizable lighting styles.

## Visual target

Warm upscale gaming lounge: parquet floor, layered rugs, warm colored walls, soft zonal lights, emissive screens, readable shadows, indirect-light support, reflection probes and restrained post-processing. The first prototype uses procedural materials to validate composition. Production materials will use base color, roughness, normal and optional AO/height maps.

## Technical stages

### Stage 1 — layout proof

- Procedural geometry and materials.
- Player movement and room switching.
- Tablet spatial anchor.
- Expansion markers.
- First lighting/shadow baseline.

### Stage 2 — asset pipeline

- Blender/Blockbench source files.
- GLB export conventions: meters, applied transforms, named material slots, collision meshes where useful.
- Godot native GLB/FBX importer.
- Extract external `.tres` materials for tuning in Godot.
- Optional editor productivity plugins only after the baseline works without them.

### Stage 3 — presentation quality

- Real PBR parquet, walls, fabric and furniture materials.
- LightmapGI for mostly static architecture.
- Reflection probes for screens, lacquered wood and metal.
- Quality presets for gamer PCs, with reduced effects when a real game launches.
- Occlusion/LOD review once imported assets are present.

### Stage 4 — interaction vertical slice

- Walk to a game display.
- Highlight and inspect a `GameRecord`.
- Open the existing library UI in the tablet.
- Launch through the existing Steam service boundary.
- Return from the game to the same room and state.

### Stage 5 — social slice

- Presence and avatar transforms through the existing backend.
- Voice room and spatial attenuation.
- Shared video state, with clients rendering the media locally.
- Public room permissions and private-room access.

## Import and asset policy

Use GLB/glTF first. It is the most predictable runtime interchange format for Godot and preserves PBR materials better than OBJ. FBX remains a supported input for third-party assets, but should be converted or normalized when a source asset behaves inconsistently. Do not make Sketchfab or another asset service a runtime dependency.

Recommended sources for the first art pass:

- Poly Haven: CC0 PBR materials and HDRIs.
- ambientCG: CC0 PBR materials, HDRIs and models.
- Kenney: CC0 stylized arcade/reference assets.
- Quaternius: CC0 characters and animation references.

The repository should store only approved, redistributable assets and a small attribution/license manifest for every imported source.

## Explicit decisions

- Native Godot 3D is the primary prototype; raw Three.js is not the first implementation path.
- The 3D world is data-driven and expandable.
- The tablet is the stable boundary between the world and the existing 2D application.
- Built-in importers are preferred over importer plugins.
- No multiplayer or CEF integration is required to validate the first room layout.
