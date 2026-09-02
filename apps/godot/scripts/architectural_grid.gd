class_name ArchitecturalGrid
extends RefCounted

## Canonical metric grid for all generated Game Access architecture.
##
## Horizontal room geometry is expressed as whole one-meter cells. Keeping this
## contract in one place makes room generation, decoration placement, navigation
## and future room editing use the same coordinate system.

const CELL_SIZE_M := 1.0
const WALL_HEIGHT_M := 3.0
const FLOOR_TILE_GAP_M := 0.025
const WALL_PANEL_GAP_M := 0.018
const WALL_THICKNESS_M := 0.20
const FLOOR_THICKNESS_M := 0.14
const CEILING_THICKNESS_M := 0.12
const COLUMN_RADIUS_M := 0.20
const WALL_PIER_SIZE_M := 0.26

static func cell_count(length_m: float) -> int:
	return maxi(1, int(round(length_m / CELL_SIZE_M)))

static func snapped_length(length_m: float) -> float:
	return float(cell_count(length_m)) * CELL_SIZE_M

static func snapped_room_size(value: Vector3) -> Vector3:
	return Vector3(snapped_length(value.x), WALL_HEIGHT_M, snapped_length(value.z))

static func cell_center(column: int, row: int, columns: int, rows: int) -> Vector3:
	var left := -float(columns) * CELL_SIZE_M * 0.5
	var north := -float(rows) * CELL_SIZE_M * 0.5
	return Vector3(
		left + (float(column) + 0.5) * CELL_SIZE_M,
		0.0,
		north + (float(row) + 0.5) * CELL_SIZE_M
	)

static func grid_line_position(line_index: int, line_count: int) -> float:
	return -float(line_count) * CELL_SIZE_M * 0.5 + float(line_index) * CELL_SIZE_M

static func clamp_cell(cell: Vector2i, columns: int, rows: int) -> Vector2i:
	return Vector2i(
		clampi(cell.x, 0, maxi(0, columns - 1)),
		clampi(cell.y, 0, maxi(0, rows - 1))
	)
