class_name BridgeField
extends Node3D
## Bridges and viaducts from the OSM ways tagged bridge=yes.
## plan(): before roads and buildings are built — deck height profile (clearance over what passes below, max grade),
##         and earth embankments on the terrain where the deck must start above the ground.
## build(): concrete deck, road surface with its paint, parapets (concrete barrier on main roads, metal railing
##          elsewhere), piers and abutments. Every span between two supports is a separate piece (destructible later).

const STEP := 2.0
const GRADE := 0.05            # max deck grade
const CLEAR_ROAD := 5.0        # free height over a road (m)
const CLEAR_PATH := 3.0        # over a footway / cycleway
const SPAN := 28.0             # pier spacing on long viaducts
const MAIN := ["motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"]

var terrain: Terrain3D
var bridges := []              # {r, line: PackedVector2Array, deck: PackedFloat32Array, w, thick}
var count := 0
var embank_vertices := 0


func plan(world: Dictionary, t: Terrain3D) -> void:
	terrain = t
	var under := []            # [a, b, clearance] of everything that is not a bridge
	for r in world.get("roads", []):
		if r.bridge or r.tunnel:
			continue
		var clr := CLEAR_PATH if r["class"] in ["footway", "path", "cycleway", "steps", "bridleway", "track"] else CLEAR_ROAD
		for i in r.p.size() - 1:
			under.append([Vector2(r.p[i][0], r.p[i][1]), Vector2(r.p[i + 1][0], r.p[i + 1][1]), clr, r.width])
	for r in world.get("roads", []):
		if not r.bridge or r.p.size() < 2:
			continue
		var line := RoadField.resample(r.p, STEP)
		if line.size() < 2:
			continue
		var n := line.size()
		var ground := PackedFloat32Array()
		for p in line:
			ground.append(_h(p))
		if ground.has(NAN):
			continue
		var w: float = clampf(r.width, 2.0, 30.0)
		var thick := 1.1 if r["class"] in MAIN else (0.5 if w < 4.0 else 0.8)
		# required deck top at each sample: clearance over what crosses below
		var need := PackedFloat32Array()
		need.resize(n)
		for i in n:
			need[i] = ground[i] + 0.4
		for i in n - 1:
			for u in under:
				var hit = Geometry2D.segment_intersects_segment(line[i], line[i + 1], u[0], u[1])
				if hit == null:
					continue
				var gy := _h(hit)
				var top: float = gy + float(u[2]) + thick
				# the crossing road is u[3] wide: the deck stays high over all of it
				var reach := int(ceil((float(u[3]) * 0.5 + 1.0) / STEP))
				for k in range(maxi(0, i - reach), mini(n, i + 2 + reach)):
					need[k] = maxf(need[k], top)
		# deck profile: straight between the ends, lifted to the needs with a limited grade
		var deck := PackedFloat32Array()
		deck.resize(n)
		for i in n:
			var lin := lerpf(ground[0], ground[n - 1], float(i) / (n - 1))
			var env := -INF
			for j in n:
				env = maxf(env, need[j] - GRADE * STEP * absi(i - j))
			deck[i] = maxf(lin + 0.3, env)
		deck = _smooth(deck, need)
		bridges.append({"r": r, "line": line, "deck": deck, "w": w, "thick": thick, "ground": ground,
			"skip": {"L": false, "R": false}})
	_merge_parallel()
	for b in bridges:
		var line: PackedVector2Array = b.line
		var n := line.size()
		# embankments where the deck ends above the ground
		_embank(line[0], (line[0] - line[1]).normalized(), b.deck[0] - b.ground[0], b.w)
		_embank(line[n - 1], (line[n - 1] - line[n - 2]).normalized(), b.deck[n - 1] - b.ground[n - 1], b.w)
	if embank_vertices > 0:
		terrain.data.update_maps(Terrain3DRegion.TYPE_HEIGHT)


## Smooth vertical curve (no waves): moving average, never below what the clearance needs.
static func _smooth(deck: PackedFloat32Array, need: PackedFloat32Array) -> PackedFloat32Array:
	var out := deck.duplicate()
	for pass_i in 3:
		var src := out.duplicate()
		for i in range(1, out.size() - 1):
			var a := maxi(0, i - 3)
			var b := mini(out.size() - 1, i + 3)
			var s := 0.0
			for k in range(a, b + 1):
				s += src[k]
			out[i] = maxf(s / (b - a + 1), need[i])
	return out


## Carriageways drawn as separate OSM ways side by side become one structure: same deck height at matching
## points, and no parapet on the sides that face each other (a single central barrier stays on one of them).
func _merge_parallel() -> void:
	for i in bridges.size():
		for j in range(i + 1, bridges.size()):
			var a: Dictionary = bridges[i]
			var b: Dictionary = bridges[j]
			var la: PackedVector2Array = a.line
			var lb: PackedVector2Array = b.line
			var ma := la[la.size() / 2]
			var mb := lb[lb.size() / 2]
			var da := (la[la.size() - 1] - la[0]).normalized()
			var db := (lb[lb.size() - 1] - lb[0]).normalized()
			if absf(da.dot(db)) < 0.94:
				continue
			var gap := absf((mb - ma).dot(Vector2(-da.y, da.x)))
			if gap > (a.w + b.w) * 0.5 + 4.0 or ma.distance_to(mb) > 60.0:
				continue
			# heights: each point takes the max of itself and the nearest point of the other deck
			for pair in [[a, b], [b, a]]:
				var p: Dictionary = pair[0]
				var q: Dictionary = pair[1]
				var lp: PackedVector2Array = p.line
				var lq: PackedVector2Array = q.line
				for k in lp.size():
					var best := INF
					var hk := 0.0
					for m in lq.size():
						var d := lp[k].distance_squared_to(lq[m])
						if d < best:
							best = d
							hk = q.deck[m]
					if best < 900.0:
						p.deck[k] = maxf(p.deck[k], hk)
			# facing sides: a's side towards b loses its parapet; b keeps one central barrier
			var sa := Vector2(-da.y, da.x)
			a.skip["L" if (mb - ma).dot(sa) > 0 else "R"] = true
func _embank(end: Vector2, dir: Vector2, rise: float, w: float) -> void:
	if rise < 0.6:
		return
	var top0 := _h(end) + rise
	var length := rise / GRADE
	var half := w * 0.5 + 1.0
	var vs := terrain.vertex_spacing
	var side := Vector2(-dir.y, dir.x)
	var reach := half + rise * 1.5 + vs
	var corners := [end + side * reach, end - side * reach, end + dir * (length + vs) + side * reach, end + dir * (length + vs) - side * reach]
	var x0 := INF
	var x1 := -INF
	var z0 := INF
	var z1 := -INF
	for c in corners:
		x0 = minf(x0, c.x)
		x1 = maxf(x1, c.x)
		z0 = minf(z0, c.y)
		z1 = maxf(z1, c.y)
	for gz in range(floori(z0 / vs), ceili(z1 / vs) + 1):
		for gx in range(floori(x0 / vs), ceili(x1 / vs) + 1):
			var p := Vector2(gx * vs, gz * vs)
			var d := (p - end).dot(dir)
			if d < -vs or d > length:
				continue
			var lat := absf((p - end).dot(side))
			var crest := top0 - GRADE * maxf(d, 0.0)
			var target := crest - maxf(lat - half, 0.0) / 1.5
			var g3 := Vector3(p.x, 0, p.y)
			var g := terrain.data.get_height(g3)
			if is_nan(g) or target <= g:
				continue
			terrain.data.set_height(g3, target)
			embank_vertices += 1


func build(building_mat: Material, road_mat: Material) -> void:
	var concrete := SurfaceTool.new()
	concrete.begin(Mesh.PRIMITIVE_TRIANGLES)
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for b in bridges:
		_bridge(b, concrete, surface)
	for pair in [[concrete, building_mat, true], [surface, road_mat, false]]:
		var st: SurfaceTool = pair[0]
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = pair[1]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if pair[2] else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
	print("BRIDGES ", count, " embankment vertices ", embank_vertices)


func _bridge(b: Dictionary, cst: SurfaceTool, sst: SurfaceTool) -> void:
	var r: Dictionary = b.r
	var line: PackedVector2Array = b.line
	var deck: PackedFloat32Array = b.deck
	var ground: PackedFloat32Array = b.ground
	var w: float = b.w
	var t: float = b.thick
	var n := line.size()
	var main: bool = r["class"] in MAIN
	var flags := 0
	if r.get("surface", "paved") == "paved":
		if r.get("centre") == "dashed":
			flags |= RoadField.F_DASH
		elif r.get("centre") == "solid":
			flags |= RoadField.F_SOLID
		if main:
			flags |= RoadField.F_EDGE
	var along := 0.0
	var prev := {}
	for i in n:
		var p := line[i]
		var d := (line[mini(i + 1, n - 1)] - line[maxi(i - 1, 0)]).normalized()
		var s := Vector2(-d.y, d.x)
		var y := deck[i]
		var L := p + s * (w * 0.5)
		var R := p - s * (w * 0.5)
		var cur := {"L": L, "R": R, "y": y, "v": along}
		if i > 0:
			along += line[i].distance_to(line[i - 1])
			cur.v = along
			var a := prev
			# road surface (road material: asphalt + paint)
			_quad(sst, _v(a.L, a.y + 0.02), _v(a.R, a.y + 0.02), _v(cur.R, y + 0.02), _v(cur.L, y + 0.02),
				[Vector2(0, a.v), Vector2(1, a.v), Vector2(1, along), Vector2(0, along)], Vector2(0 if r.get("surface", "paved") == "paved" else 1, flags), Color(w / 20.0, 0, 0, 0))
			# deck sides and underside (concrete)
			var c := Color(0, 0, 0, 0.5)
			var uv2 := Vector2(4, 1)    # building layer 4 = concrete
			for side in [["L", 1.0], ["R", -1.0]]:
				var k: String = side[0]
				_quad(cst, _v(a[k], a.y - t), _v(cur[k], y - t), _v(cur[k], y + 0.05), _v(a[k], a.y + 0.05),
					[Vector2(a.v, 0), Vector2(along, 0), Vector2(along, t), Vector2(a.v, t)], uv2, c)
			_quad(cst, _v(a.L, a.y - t), _v(a.R, a.y - t), _v(cur.R, y - t), _v(cur.L, y - t),
				[Vector2(0, a.v), Vector2(w, a.v), Vector2(w, along), Vector2(0, along)], uv2, c)
			# parapets: concrete barrier (main roads) or a metal railing
			for side in [["L", 1.0], ["R", -1.0]]:
				var k: String = side[0]
				if b.skip[k]:
					continue
				var inward: Vector2 = (cur.R - cur.L).normalized() * (0.4 if k == "L" else -0.4)
				var hh := 0.9 if main else 1.05
				var lay := 4 if main else 5
				var a_out: Vector2 = a[k]
				var c_out: Vector2 = cur[k]
				var a_in: Vector2 = a_out + (inward if main else inward * 0.15)
				var c_in: Vector2 = c_out + (inward if main else inward * 0.15)
				for face in [[a_out, c_out], [a_in, c_in]]:
					_quad(cst, _v(face[0], a.y), _v(face[1], y), _v(face[1], y + hh), _v(face[0], a.y + hh),
						[Vector2(a.v, 0), Vector2(along, 0), Vector2(along, hh), Vector2(a.v, hh)], Vector2(lay, 1), c)
				_quad(cst, _v(a_out, a.y + hh), _v(c_out, y + hh), _v(c_in, y + hh), _v(a_in, a.y + hh),
					[Vector2(a.v, 0), Vector2(along, 0), Vector2(along, 0.4), Vector2(a.v, 0.4)], Vector2(lay, 1), c)
		prev = cur
	# piers on long or high spans (never on a road below), abutments at both ends
	var total := along
	var spans := maxi(1, int(round(total / SPAN)))
	if total > SPAN * 1.4:
		for k in range(1, spans):
			var i := int(round(float(k) / spans * (n - 1)))
			if deck[i] - ground[i] > 2.5:
				_pier(cst, line, i, deck[i] - t, ground[i], w)
	for i in [0, n - 1]:
		if deck[i] - t > ground[i] + 0.3:
			_pier(cst, line, i, deck[i] - t, ground[i] - 1.0, w, true)
	count += 1


func _pier(st: SurfaceTool, line: PackedVector2Array, i: int, top: float, bottom: float, w: float, abutment := false) -> void:
	var n := line.size()
	var d := (line[mini(i + 1, n - 1)] - line[maxi(i - 1, 0)]).normalized()
	var s := Vector2(-d.y, d.x)
	var hw := w * (0.5 if abutment else 0.32)
	var hd := 0.8 if abutment else 0.6
	var p := line[i]
	var q := [p + s * hw - d * hd, p + s * hw + d * hd, p - s * hw + d * hd, p - s * hw - d * hd]
	var c := Color(0, 0, 0, 0.4)
	for k in 4:
		var a: Vector2 = q[k]
		var b: Vector2 = q[(k + 1) % 4]
		var len := a.distance_to(b)
		_quad(st, _v(a, bottom - 1.0), _v(b, bottom - 1.0), _v(b, top), _v(a, top),
			[Vector2(0, 0), Vector2(len, 0), Vector2(len, top - bottom), Vector2(0, top - bottom)], Vector2(4, len), c)


## A camera spot looking at the longest bridge (for the screenshots).
func view_spot() -> Array:
	var best := {}
	var bl := 0.0
	for b in bridges:
		var l: float = b.line.size() * STEP
		if l > bl:
			bl = l
			best = b
	if best.is_empty():
		return []
	var mid: Vector2 = best.line[best.line.size() / 2]
	return [Vector3(mid.x, _h(mid), mid.y), bl]


func _v(p: Vector2, y: float) -> Vector3:
	return Vector3(p.x, y, p.y)


func _quad(st: SurfaceTool, a0: Vector3, b0: Vector3, b1: Vector3, a1: Vector3, uv: Array, uv2: Vector2, col: Color) -> void:
	var n := (b0 - a0).cross(a1 - a0).normalized()
	if n.length() < 0.5:
		return
	var vs := [a0, b0, b1, a0, b1, a1]
	var uvs := [uv[0], uv[1], uv[2], uv[0], uv[2], uv[3]]
	for tri in [[0, 1, 2], [3, 4, 5]]:
		# double-sided pieces (railings, deck edges): emit both windings
		for o in [[0, 1, 2], [0, 2, 1]]:
			var nn := n if o == [0, 1, 2] else -n
			for k in o:
				st.set_normal(nn)
				st.set_uv(uvs[tri[k]])
				st.set_uv2(uv2)
				st.set_color(col)
				st.add_vertex(vs[tri[k]])


func _h(p: Vector2) -> float:
	return terrain.data.get_height(Vector3(p.x, 0, p.y))
