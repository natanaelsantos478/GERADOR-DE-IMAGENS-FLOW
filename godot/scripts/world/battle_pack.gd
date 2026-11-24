class_name BattlePack
extends RefCounted
## Battle pack written by the strategy game (docs/BATALHA_GODOT.md §3). Local metres, origin at the
## centre, +X east, +Z south, Y up.

var dir := ""
var meta: Dictionary = {}
var size_m := 10000.0
var border_m := 500.0
var span_m := 11000.0
var height: Image        # FORMAT_RF, n x n, row 0 = north edge
var cover: Image         # RGB8: base material, overlay material, blend
var landcover: Image     # RGB8: class (see LandCover), confidence
var tint: Image          # RGBA8: colour map (rgb <= 1, a = roughness 0.5 neutral)

enum LandCover { UNKNOWN, MEADOW, CROP_GREEN, CROP_DRY, BARE, BROADLEAF, CONIFER, PAVED, ROOF, WATER, ROCK }


static func open(path: String) -> BattlePack:
	var p := BattlePack.new()
	p.dir = path
	var txt := FileAccess.get_file_as_string(path.path_join("battle.json"))
	var parsed = JSON.parse_string(txt)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("battle.json missing or invalid in %s" % path)
		return null
	p.meta = parsed
	p.size_m = p.meta.get("sizeM", 10000.0)
	p.border_m = p.meta.get("borderM", 500.0)
	p.span_m = p.meta.height.spanM
	return p


func load_height() -> void:
	var n: int = meta.height.n
	var bytes := FileAccess.get_file_as_bytes(dir.path_join(meta.height.file))
	height = Image.create_from_data(n, n, false, Image.FORMAT_RF, bytes)


## Roads and buildings (OSM) — empty when the pack has none.
func load_world() -> Dictionary:
	var f := dir.path_join("world.json")
	if not FileAccess.file_exists(f):
		return {}
	var d = JSON.parse_string(FileAccess.get_file_as_string(f))
	return d if typeof(d) == TYPE_DICTIONARY else {}


func load_maps() -> void:
	cover = Image.load_from_file(dir.path_join(meta.cover.file))
	landcover = Image.load_from_file(dir.path_join(meta.landcover.file))
	tint = Image.load_from_file(dir.path_join(meta.tint.file))
	for img in [cover, landcover]:
		if img.get_format() != Image.FORMAT_RGB8:
			img.convert(Image.FORMAT_RGB8)
	if tint.get_format() != Image.FORMAT_RGBA8:
		tint.convert(Image.FORMAT_RGBA8)


## Pixel of a map (n x n covering span_m) under a world position.
func map_px(img: Image, x: float, z: float) -> Vector2i:
	var n := img.get_width()
	var u := (x / span_m + 0.5) * n
	var v := (z / span_m + 0.5) * n
	return Vector2i(clampi(int(u), 0, n - 1), clampi(int(v), 0, n - 1))


func hour() -> float:
	return meta.get("time", {}).get("hour", 14.0)


func day_of_year() -> int:
	return meta.get("time", {}).get("dayOfYear", 180)


func latitude() -> float:
	return meta.get("lat", 45.0)
