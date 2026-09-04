# GameAccess 3D prototype

This is the first native Godot layout prototype for GameAccess. It is intentionally isolated from `apps/desktop` so the rendering and room-design decision can be validated before the React/Tauri application is embedded.

## Run

1. Open `apps/godot/project.godot` with Godot 4.x.
2. Run the project.
3. Click the viewport to capture the mouse.
4. Use `WASD` or the arrow keys to move, `Esc` to release the mouse, `Tab` to show the tablet, `1` for the community hall and `2` for the private room.

## What is implemented

- A data-driven community hall and private room in `data/rooms.json`.
- Reusable procedural shell, parquet, rugs, warm walls, furniture, arcade cabinets, banners and expansion markers.
- Zonal warm/teal lighting, dynamic shadows, filmic tonemapping and glow.
- First-person movement and a spatial tablet placeholder attached to the player camera.
- Expansion markers on room boundaries so future modules can be appended without changing the existing room definition.

## Asset pipeline decision

The project will use GLB/glTF as the primary production format. Godot 4 has native glTF/GLB and FBX import, so an importer plugin is not required for the first pipeline. External models should follow:

```text
Blender / Blockbench
        ↓
       GLB
        ↓
Godot native importer
        ↓
Extracted .tres materials + room instances
```

PBR material maps will be added after the proportions and lighting pass are approved. Poly Haven and ambientCG are the preferred CC0 sources for wood, wall, fabric and floor materials. A placement/scatter editor plugin may be evaluated later, but the room data model must remain usable without it.

## Next vertical slice

1. Replace the procedural parquet with a real parquet PBR set and compare visual quality.
2. Replace two arcade placeholders with imported GLB assets.
3. Convert the tablet screen to a `SubViewport` and connect it to the existing GameAccess library contract.
4. Add a real door/portal between the community and private spaces.
5. Add quality presets and baked `LightmapGI` for static geometry, retaining a dynamic-light fallback for user-customized rooms.
