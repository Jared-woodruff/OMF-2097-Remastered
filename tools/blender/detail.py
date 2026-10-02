"""Surface detail for the generated robots' parts, laid on in Blender (render_frames.py): plates, panel seams and bolts
on the armor, worn paint (grime, chips gathering on the edges, flecks, scratches), machined rings and caps on the
joints, borders and spines on blades, polished and tarnished metal, lights with bright cores, and each robot's own
(HELIX's spiral drill, tread soles and drill bits, GLACIER's faceted ice, TEMPEST's turbine and wind, SPECTRE's
emblem).

Everything is computed in the part's own coordinates (its object space: the export puts every part's shape at its
object's origin), so it is the same in every frame; nothing is painted per frame. Colors keep each zone's hue: the
game recolors every HD pixel through the sprite pixel it belongs to, keeping the picture's shading but taking the hue
from the player's colors, so detail shows as shading (grooves, domes, lighter chipped edges), never as another hue.

Units: the parts' extras give their shapes in game units (a native pixel's width); `U` meters per unit.
Axes: glTF's y (a shape's own axis) is Blender's Z, its z (toward the viewer) is Blender's -Y.
"""
import math

import bpy

U = 0.01
RBOX, ELLIPSOID, CAPSULE, CYLINDER, CONE, RCONE, WEDGE, TBOX, PRISM = range(9)


class G:
    """A node graph builder: math on sockets and numbers."""

    def __init__(self, nt):
        self.nt = nt

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def _in(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = float(v)
        else:
            self.nt.links.new(v, sock)

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        self._in(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b): return self.math("ADD", a, b)
    def sub(self, a, b): return self.math("SUBTRACT", a, b)
    def mul(self, a, b): return self.math("MULTIPLY", a, b)
    def div(self, a, b): return self.math("DIVIDE", a, b)
    def max(self, a, b): return self.math("MAXIMUM", a, b)
    def min(self, a, b): return self.math("MINIMUM", a, b)
    def abs(self, a): return self.math("ABSOLUTE", a)
    def fract(self, a): return self.math("FRACT", a)
    def sqrt(self, a): return self.math("SQRT", self.math("MAXIMUM", a, 0.0))
    def pow(self, a, b): return self.math("POWER", a, b)
    def round(self, a): return self.math("ROUND", a)
    def sin(self, a): return self.math("SINE", a)
    def cos(self, a): return self.math("COSINE", a)
    def atan2(self, y, x): return self.math("ARCTAN2", y, x)
    def clamp01(self, a): return self.math("ADD", a, 0.0, clamp=True)

    def hypot(self, a, b):
        return self.sqrt(self.add(self.mul(a, a), self.mul(b, b)))

    def band(self, d, width, soft=0.5):
        """1 where |d| < width (a line of that half width), easing out over `soft` of it."""
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self._in(n.inputs["Value"], self.abs(d))
        n.inputs["From Min"].default_value = width * (1 - soft)
        n.inputs["From Max"].default_value = width
        n.inputs["To Min"].default_value = 1.0
        n.inputs["To Max"].default_value = 0.0
        return n.outputs["Result"]

    def below(self, a, edge, soft=0.1):
        """1 where a < edge (softly)."""
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self._in(n.inputs["Value"], a)
        self._in(n.inputs["From Min"], self.sub(edge, soft) if not isinstance(edge, (int, float)) else edge - soft)
        self._in(n.inputs["From Max"], edge)
        n.inputs["To Min"].default_value = 1.0
        n.inputs["To Max"].default_value = 0.0
        return n.outputs["Result"]

    def dome(self, dist, radius):
        """A rivet's height profile: 1 at its center, 0 at `radius`."""
        t = self.clamp01(self.sub(1.0, self.div(self.mul(dist, dist), radius * radius)))
        return self.sqrt(t)

    def coords(self):
        """The part's own coordinates in game units and its object-space normal: (x, y, z) sockets each."""
        tc = self.node("ShaderNodeTexCoord")
        sc = self.node("ShaderNodeVectorMath", operation="SCALE")
        self.nt.links.new(tc.outputs["Object"], sc.inputs[0])
        sc.inputs["Scale"].default_value = 1.0 / U
        p = self.node("ShaderNodeSeparateXYZ")
        self.nt.links.new(sc.outputs["Vector"], p.inputs[0])
        # (the object-space normal: the geometry normal turned back into the object's frame)
        geo = self.node("ShaderNodeNewGeometry")
        vt = self.node("ShaderNodeVectorTransform", vector_type="NORMAL", convert_from="WORLD", convert_to="OBJECT")
        self.nt.links.new(geo.outputs["Normal"], vt.inputs[0])
        nn = self.node("ShaderNodeVectorMath", operation="NORMALIZE")
        self.nt.links.new(vt.outputs[0], nn.inputs[0])
        n = self.node("ShaderNodeSeparateXYZ")
        self.nt.links.new(nn.outputs["Vector"], n.inputs[0])
        return (p.outputs["X"], p.outputs["Y"], p.outputs["Z"]), (n.outputs["X"], n.outputs["Y"], n.outputs["Z"])


def weights(g, n):
    """Triplanar weights from the object-space normal (sharp: the faces are flat, only the rounded edges blend)."""
    w = [g.pow(g.abs(c), 6.0) for c in n]
    total = g.add(g.add(w[0], w[1]), g.add(w[2], 1e-4))
    return [g.div(c, total) for c in w]


def bolt(g, dist, r):
    """A bolt head: its dome (1 in the middle) and the dark ring of its socket around it."""
    return g.dome(dist, r), g.band(g.sub(dist, r * 1.2), r * 0.28)


def panel(g, u, v, hu, hv, spec):
    """A flat face's detail in its plane (u, v; half extents hu, hv: numbers or sockets): a plate standing a little
    proud of an inset border seam, seams dividing big faces, bolts in its corners (and in rows along long borders).
    Returns (seam, rivet, plate) masks (bolts' socket rings count as seams)."""
    inset, width, rivet_r = spec["inset"], spec["seam"], spec["rivet"]
    au, av = g.abs(u), g.abs(v)
    iu = g.sub(hu, inset) if not isinstance(hu, (int, float)) else hu - inset
    iv = g.sub(hv, inset) if not isinstance(hv, (int, float)) else hv - inset
    # The plate: a soft step up inside the border (a lit edge and a shaded one, like a bevelled plate).
    plate = g.mul(g.below(au, iu, spec["step"]), g.below(av, iv, spec["step"]))
    # The border: two pairs of lines, each only as long as the inner panel.
    lu = g.mul(g.band(g.sub(au, iu), width), g.below(av, iv if isinstance(iv, (int, float)) else iv, 0.05))
    lv = g.mul(g.band(g.sub(av, iv), width), g.below(au, iu if isinstance(iu, (int, float)) else iu, 0.05))
    seam = g.max(lu, lv)
    # Big faces: divided into panels about `pitch` units long (constant extents only).
    for coord, h_in, other, o_in in ((u, iu, av, iv), (v, iv, au, iu)):
        if not isinstance(h_in, (int, float)) or h_in * 2 < spec["pitch"] * 1.6:
            continue
        n = max(2, round(h_in * 2 / spec["pitch"]))
        step = h_in * 2 / n
        t = g.fract(g.div(g.add(coord, h_in), step))
        d = g.mul(g.sub(t, g.round(t)), step)
        inside = g.mul(g.below(g.abs(coord), h_in - width * 2, 0.05), g.below(other, o_in, 0.05))
        seam = g.max(seam, g.mul(g.band(d, width), inside))
    # Rivets just inside the border: in rows along it where it is long enough, else at its corners.
    ri = spec["rivet_in"]
    pu = g.sub(iu, ri) if not isinstance(iu, (int, float)) else iu - ri
    pv = g.sub(iv, ri) if not isinstance(iv, (int, float)) else iv - ri
    rivet, ring = bolt(g, g.hypot(g.sub(au, pu), g.sub(av, pv)), rivet_r)
    for across, along, pos, length in ((au, v, pu, pv), (av, u, pv, pu)):
        if not isinstance(length, (int, float)) or length * 2 < spec["rivet_step"] * 2.2:
            continue
        count = max(2, int(length * 2 / spec["rivet_step"]))
        step = length * 2 / count
        t = g.fract(g.div(g.add(along, length), step))
        within = g.below(g.abs(along), length + rivet_r, 0.05)
        head, socket = bolt(g, g.hypot(g.sub(across, pos), g.mul(g.sub(t, 0.5), step)), rivet_r)
        rivet = g.max(rivet, g.mul(head, within))
        ring = g.max(ring, g.mul(socket, within))
    return g.max(seam, g.mul(ring, 0.8)), rivet, plate


def box_detail(g, p, n, sh, spec):
    """Boxes and tapered boxes: the panel detail on every face, blended by the normal. Returns (seam, rivet, plate)."""
    x, y, z = p
    # Half extents along Blender's X, Y, Z: the shape's a, c (its z), b (its y); a tapered box narrows along its y.
    hx, hy, hz = sh["a"], sh["c"], sh["b"]
    if sh["kind"] == TBOX and abs(sh.get("k", 1) - 1) > 1e-3:
        f = g.add(1.0, g.mul(sh["k"] - 1, g.div(g.add(g.math("MINIMUM", g.max(z, -hz), hz), hz), 2 * hz)))
        hx, hy = g.mul(f, hx), g.mul(f, hy)
    wx, wy, wz = weights(g, n)
    # (each face with its size at rest, for the size check: X faces span the shape's c and b, Y faces a and b, Z faces a and c)
    faces = [(wx, y, z, hy, hz, min(sh["c"], sh["b"])), (wy, x, z, hx, hz, min(sh["a"], sh["b"])), (wz, x, y, hx, hy, min(sh["a"], sh["c"]))]
    seam = rivet = plate = 0.0
    for w, u, v, hu, hv, small in faces:
        if small < spec["min_face"]:
            continue
        s, r, pl = panel(g, u, v, hu, hv, spec)
        seam = g.add(seam, g.mul(w, s)) if seam != 0.0 else g.mul(w, s)
        rivet = g.add(rivet, g.mul(w, r)) if rivet != 0.0 else g.mul(w, r)
        plate = g.add(plate, g.mul(w, pl)) if plate != 0.0 else g.mul(w, pl)
    return seam, rivet, plate


def prism_angle(g, p, sh):
    """The angle around a prism's axis (its y, Blender's Z) and the nearest facet's center angle."""
    x, y, z = p
    squash = sh.get("c") or 1.0
    # (Blender's Y is the shape's -z; a squashed prism is thinner along it)
    theta = g.atan2(g.div(g.mul(y, -1.0), squash), x)
    sector = 2 * math.pi / max(3, round(sh.get("k", 6)))
    center = g.mul(g.round(g.div(theta, sector)), sector)
    return theta, center


def prism_detail(g, p, n, sh, spec, rivets=True):
    """Faceted tubes (limbs, stacks): seam rings near the ends and between long sections, rivets on each facet by the
    end rings; the caps get a machined face. Returns (seam, rivet, plate: none)."""
    x, y, z = p
    half = sh["a"]
    cap = g.below(g.sub(1.0, g.abs(n[2])), 0.25, 0.1)
    side = g.sub(1.0, cap)
    seam = rivet = 0.0
    if half > spec["min_face"]:
        ring = g.band(g.sub(g.abs(z), half - spec["inset"]), spec["seam"])
        seam = ring
        if half * 2 > spec["pitch"] * 1.6:
            count = max(2, round(half * 2 / spec["pitch"]))
            step = half * 2 / count
            t = g.fract(g.div(g.add(z, half), step))
            d = g.mul(g.sub(t, g.round(t)), step)
            seam = g.max(seam, g.mul(g.band(d, spec["seam"]), g.below(g.abs(z), half - spec["inset"] * 1.5, 0.05)))
        if rivets:
            theta, center = prism_angle(g, p, sh)
            # Along the facet: the distance from its middle; along the axis: from the rivets' ring.
            radius = max(sh["b"], sh["r"])
            s = g.mul(g.sub(theta, center), radius)
            dz = g.sub(g.abs(z), half - spec["inset"] - spec["rivet_in"])
            rivet, ring = bolt(g, g.hypot(s, dz), spec["rivet"])
            seam = g.max(seam, g.mul(ring, 0.8))
        seam = g.mul(seam, side)
        rivet = g.mul(rivet, side) if rivet != 0.0 else 0.0
    # The caps: a machined face, a ring groove and a bolt in the middle.
    rho = g.hypot(x, y)
    rr = max(sh["b"], sh["r"])
    if rr > 1.2:
        cap_ring = g.band(g.sub(rho, rr * 0.62), spec["seam"] * 0.8)
        head = g.dome(rho, min(0.75, rr * 0.3))
        seam = g.add(seam, g.mul(cap, cap_ring)) if seam != 0.0 else g.mul(cap, cap_ring)
        rivet = g.add(rivet, g.mul(cap, head)) if rivet != 0.0 else g.mul(cap, head)
    return seam, rivet, 0.0


def grooves(g, coord, pitch, width):
    """Evenly spaced grooves across a coordinate (machined rings, treads)."""
    t = g.fract(g.div(coord, pitch))
    return g.band(g.mul(g.sub(t, 0.5), pitch), width)


def wedge_detail(g, p, n, sh, spec):
    """Blades, fins and wedge plates: on their two flat faces, a plate inside an inset border and a groove down the
    spine (from the base's middle to the tip) of long ones. Returns (seam, rivet: none, plate)."""
    a, b, k, r = sh["a"], sh["b"], sh.get("k") or 0.0, sh.get("r") or 0.0
    V = [(-a, -b), (a, -b), (k, b)]
    if (V[1][0] - V[0][0]) * (V[2][1] - V[0][1]) - (V[1][1] - V[0][1]) * (V[2][0] - V[0][0]) < 0:
        V = [V[0], V[2], V[1]]
    sides = [math.hypot(V[(i + 1) % 3][0] - V[i][0], V[(i + 1) % 3][1] - V[i][1]) for i in range(3)]
    inradius = abs((V[1][0] - V[0][0]) * (V[2][1] - V[0][1]) - (V[1][1] - V[0][1]) * (V[2][0] - V[0][0])) / sum(sides)
    inset = max(0.25, spec["inset"] * 0.7 - r)
    if inradius < inset + 0.8:
        return 0.0, 0.0, 0.0
    # (the triangle lies in the shape's x-y plane: Blender's X-Z; its faces look along Blender's Y)
    x, z = p[0], p[2]
    inside = None
    for i in range(3):
        (x0, y0), (x1, y1) = V[i], V[(i + 1) % 3]
        l = sides[i] or 1.0
        nx, ny = -(y1 - y0) / l, (x1 - x0) / l
        d = g.add(g.mul(g.sub(x, x0), nx), g.mul(g.sub(z, y0), ny))
        inside = d if inside is None else g.min(inside, d)
    flat = g.below(g.sub(1.0, g.abs(n[1])), 0.3, 0.1)
    seam = g.mul(g.band(g.sub(inside, inset), spec["seam"]), flat)
    plate = g.mul(g.below(g.sub(inset, inside), 0.0, spec["step"]), flat)
    mx, my = 0.0, -b
    length = math.hypot(k - mx, b - my)
    if length > 6.0:
        dx, dy = (k - mx) / length, (b - my) / length
        across = g.abs(g.sub(g.mul(g.sub(x, mx), dy), g.mul(g.sub(z, my), dx)))
        spine = g.mul(g.band(across, spec["seam"] * 0.9), g.below(g.sub(inset * 2.2, inside), 0.0, 0.2))
        seam = g.max(seam, g.mul(spine, flat))
    return seam, 0.0, plate


def turbine(g, p, n, sh, blades=11):
    """A turbine's fan on a prism's caps: swept blades between a hub and the rim. Returns (grooves, hub)."""
    x, y, _ = p
    rr = max(sh["b"], sh["r"])
    rho = g.hypot(x, y)
    theta = g.atan2(y, x)
    cap = g.below(g.sub(1.0, g.abs(n[2])), 0.25, 0.1)
    sweep = g.add(g.div(g.mul(theta, blades), 2 * math.pi), g.div(rho, rr * 0.9))
    t = g.fract(sweep)
    vanes = g.band(g.sub(t, 0.5), 0.16, 0.5)
    ring = g.mul(g.below(rho, rr * 0.82, 0.15), g.sub(1.0, g.below(rho, rr * 0.34, 0.1)))
    hub = g.dome(rho, rr * 0.3)
    return g.mul(g.mul(vanes, ring), cap), g.mul(hub, cap)


# ---- robots' signature details --------------------------------------------------------------------------------------

def drill_bit(g, p, pitch=5.0):
    """A two-start spiral groove around a part's own axis (a cone's: the drill bits HELIX fires)."""
    x, y, z = p
    theta = g.atan2(g.mul(y, -1.0), x)
    t = g.fract(g.add(g.div(theta, math.pi), g.div(z, pitch)))
    return g.band(g.sub(t, 0.5), 0.16, 0.6)


SIGNATURES = {
    # part key -> what it gets
    # (HELIX's drill is a mesh of its own: REPLACEMENTS)
    "HELIX": {"footF.2": "treads", "footB.2": "treads"},
    "TEMPEST": {"chest.1": "turbine"},
    "SPECTRE": {"chest.1": "emblem"},
}
# Parts and props (projectiles, effects: their keys are their shapes) -> what they get, by a test on their extras.
PROP_SIGNATURES = {
    "HELIX": [(lambda info: info.get("role") == "prop" and (info.get("shape") or {}).get("kind") == CONE, "bit")],
    # GLACIER's ice crystals (the five-sided spikes of its accent color) and its ice (projectiles, spikes, shards).
    "GLACIER": [(lambda info: info.get("zone") == "secondary" and (info.get("shape") or {}).get("kind") == PRISM, "crystal"),
                (lambda info: info.get("role") == "prop" and info.get("zone") == "effect", "crystal")],
    # TEMPEST's wind: the blades of air it throws.
    "TEMPEST": [(lambda info: info.get("role") == "prop" and info.get("zone") == "effect", "wind")],
}


# ---- materials ------------------------------------------------------------------------------------------------------

def find(nt, kind):
    return next((n for n in nt.nodes if n.type == kind), None)


DEFAULT_SPEC = {
    # (game units) border inset, seam half width, bolt radius and how far inside the border, panel length, the
    # smallest face half size that gets a border, bolts' spacing in rows, the plate's step width
    "inset": 0.9, "seam": 0.16, "rivet": 0.45, "rivet_in": 0.75, "pitch": 11.0, "min_face": 1.6, "rivet_step": 4.6,
    "step": 0.4,
}


def detail_object(ob, robot, spec=None):
    """Gives the object its own copy of its material with the detail built in (see above). Returns what it added."""
    spec = {**DEFAULT_SPEC, **(spec or {})}
    info = ob.get("omf")
    if info is None or not ob.material_slots:
        return None
    info = info.to_dict() if hasattr(info, "to_dict") else dict(info)
    sh = info.get("shape") or {}
    zone = info.get("zone")
    key = ob.name
    slot = ob.material_slots[0]
    base = slot.material
    if base is None:
        return None
    mat = base.copy()
    mat.name = f"{base.name}@{ob.name}"
    slot.link = "OBJECT"
    slot.material = mat
    nt = mat.node_tree
    bsdf = find(nt, "BSDF_PRINCIPLED")
    bevel = find(nt, "BEVEL")
    if not bsdf:
        return None
    g = G(nt)
    p, n = g.coords()
    kind = sh.get("kind")
    if info.get("glow"):
        if zone == "effect":
            # (energy: flashes and beams, white-hot in the middle, their color at the rim, a little restless)
            return glow_core(g, nt, bsdf, p, sh, "plasma", rim=0.7, core=2.6)
        return glow_core(g, nt, bsdf, p, sh, SIGNATURES.get(robot, {}).get(key))
    what = SIGNATURES.get(robot, {}).get(key)
    if what is None:
        what = next((w for test, w in PROP_SIGNATURES.get(robot, []) if test(info)), None)
    if what == "crystal":
        return crystal(g, nt, bsdf, p)
    if what == "wind":
        return wind(g, nt, bsdf, p)
    seam = rivet = plate = 0.0
    extra = 0.0
    if what == "bit":
        extra = drill_bit(g, p)
    elif what == "turbine":
        extra, rivet = turbine(g, p, n, sh)
    elif what == "treads":
        extra = g.mul(grooves(g, p[0], 1.9, 0.5), g.below(g.abs(n[2]), 0.6, 0.1))
    if kind == WEDGE and zone in ("primary", "secondary"):
        seam, rivet, plate = wedge_detail(g, p, n, sh, spec)
    elif zone == "primary":
        if kind in (RBOX, TBOX):
            seam, rivet, plate = box_detail(g, p, n, sh, spec)
        elif kind == PRISM:
            seam, rivet, plate = prism_detail(g, p, n, sh, spec)
    elif zone == "tertiary" and what != "turbine":
        if kind == PRISM:
            # Joint rings, stacks and pistons: machined grooves around them and the caps' machined face.
            seam, rivet, plate = prism_detail(g, p, n, sh, {**spec, "inset": 0.5, "pitch": 2.4}, rivets=False)
        elif kind in (RBOX, TBOX):
            seam, rivet, plate = box_detail(g, p, n, sh, {**spec, "inset": 0.55, "rivet": 0.32, "rivet_in": 0.5, "pitch": 5.0,
                                                          "rivet_step": 3.2, "step": 0.3})
    # (effect colors are bare metal too: projectiles)
    weathered(g, nt, bsdf, p, zone, bevel)
    if seam == 0.0 and rivet == 0.0 and extra == 0.0 and plate == 0.0:
        return "weathered"
    # Height: plates up, grooves in, rivets out (meters), bumped on top of the rounded edges' normal.
    height = 0.0 if plate == 0.0 else g.mul(plate, 0.16 * U)
    if seam != 0.0 and height != 0.0:
        height = g.add(height, g.mul(seam, -0.26 * U))
    elif seam != 0.0:
        height = g.mul(seam, -0.26 * U)
    if extra != 0.0:
        height = g.add(height, g.mul(extra, -0.22 * U)) if height != 0.0 else g.mul(extra, -0.22 * U)
    if rivet != 0.0:
        height = g.add(height, g.mul(rivet, 0.26 * U)) if height != 0.0 else g.mul(rivet, 0.26 * U)
    bump = g.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 1.0
    g._in(bump.inputs["Height"], height)
    if bevel:
        nt.links.new(bevel.outputs["Normal"], bump.inputs["Normal"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    if "Coat Normal" in bsdf.inputs:
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Coat Normal"])
    # Grooves hold dirt: the color a little darker in them (same hue).
    dirt = seam if extra == 0.0 else (extra if seam == 0.0 else g.max(seam, extra))
    base_in = bsdf.inputs["Base Color"]
    if base_in.is_linked:
        src = base_in.links[0].from_socket
        dark = g.node("ShaderNodeVectorMath", operation="SCALE")
        nt.links.new(src, dark.inputs[0])
        g._in(dark.inputs["Scale"], g.sub(1.0, g.mul(dirt, 0.75)))
        nt.links.new(dark.outputs["Vector"], base_in)
    return what or kind


def half_extents(sh):
    """A shape's half size along its object's axes (Blender X, Y, Z: the shape's x, z, y), roughly."""
    kind, a, b, c, r = sh.get("kind"), sh.get("a", 1), sh.get("b", 1), sh.get("c", 1), sh.get("r", 1)
    if kind in (RBOX, TBOX, ELLIPSOID):
        return a, c, b
    if kind == PRISM:
        rr = max(r, b)
        return rr, rr * (c or 1), a
    if kind == WEDGE:
        return max(a, abs(sh.get("k") or 0)), c, b
    return max(r, b), max(r, b), a


def glow_core(g, nt, bsdf, p, sh, what=None, rim=0.45, core=1.4):
    """A light (eyes, visors, emblems, cores, energy): deep in its color at the rim, bright in the middle, the way a lit
    lens is painted, instead of one flat blur. An emblem is lit in bars (dark lines across its height); plasma
    flickers in a pattern fixed to it (the same in every frame it shows the same)."""
    half = half_extents(sh)
    q = [g.div(p[i], max(0.3, half[i])) for i in range(3)]
    dist = g.sqrt(g.add(g.add(g.mul(q[0], q[0]), g.mul(q[1], q[1])), g.mul(q[2], q[2])))
    profile = g.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
    g._in(profile.inputs["Value"], dist)
    profile.inputs["From Min"].default_value, profile.inputs["From Max"].default_value = 0.25, 1.1
    profile.inputs["To Min"].default_value, profile.inputs["To Max"].default_value = core, rim
    strength = profile.outputs["Result"]
    if what == "emblem":
        bars = grooves(g, p[2], max(1.2, half[2] * 2 / 4.5), 0.22)
        strength = g.mul(strength, g.sub(1.0, g.mul(bars, 0.75)))
    elif what == "plasma":
        vec = g.node("ShaderNodeCombineXYZ")
        for i in range(3):
            g._in(vec.inputs[i], p[i])
        noise = g.node("ShaderNodeTexNoise", noise_dimensions="3D")
        nt.links.new(vec.outputs[0], noise.inputs["Vector"])
        noise.inputs["Scale"].default_value = 0.8
        noise.inputs["Detail"].default_value = 4.0
        strength = g.mul(strength, g.add(0.7, g.mul(noise.outputs["Factor"], 0.6)))
    g._in(bsdf.inputs["Emission Strength"], strength)
    if what == "plasma" and not bsdf.inputs["Base Color"].is_linked:
        bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
    return "glow"


def wind(g, nt, bsdf, p):
    """Air cut into blades (TEMPEST's): pale streaks of light running along each piece, over a dim body of its color."""
    base_in = bsdf.inputs["Base Color"]
    color = base_in.links[0].from_socket if base_in.is_linked else None
    for name, value in (("Metallic", 0.0), ("Roughness", 0.35)):
        sock = bsdf.inputs[name]
        for link in list(sock.links):
            nt.links.remove(link)
        sock.default_value = value
    # Streaks: a noise stretched along the piece's length (its axis: Blender Z, the shape's y).
    vec = g.node("ShaderNodeCombineXYZ")
    g._in(vec.inputs[0], g.mul(p[0], 1.6))
    g._in(vec.inputs[1], g.mul(p[1], 1.6))
    g._in(vec.inputs[2], g.mul(p[2], 0.18))
    noise = g.node("ShaderNodeTexNoise", noise_dimensions="3D")
    nt.links.new(vec.outputs[0], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 1.2
    noise.inputs["Detail"].default_value = 3.0
    streak = g.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
    nt.links.new(noise.outputs["Factor"], streak.inputs["Value"])
    streak.inputs["From Min"].default_value, streak.inputs["From Max"].default_value = 0.42, 0.68
    if color is not None:
        nt.links.new(color, bsdf.inputs["Emission Color"])
    else:
        bsdf.inputs["Emission Color"].default_value = tuple(base_in.default_value)
    g._in(bsdf.inputs["Emission Strength"], g.add(0.25, g.mul(streak.outputs["Result"], 1.6)))
    return "wind"


def crystal(g, nt, bsdf, p):
    """An ice crystal: clear and glossy (no paint, no wear), lit from inside a little where it faces the viewer, with
    faint frost veins in its own coordinates. Its color stays its zone's (the game recolors it)."""
    base_in = bsdf.inputs["Base Color"]
    for name, value in (("Metallic", 0.0), ("Roughness", 0.05), ("Coat Weight", 1.0), ("Coat Roughness", 0.02)):
        sock = bsdf.inputs[name]
        for link in list(sock.links):
            nt.links.remove(link)
        sock.default_value = value
    bsdf.inputs["Specular IOR Level"].default_value = 0.9
    # Facets: the normal tilted a little differently in each cell of a pattern fixed to the crystal, so it catches
    # the light like a cluster of shards rather than one smooth spike.
    vec0 = g.node("ShaderNodeCombineXYZ")
    for i in range(3):
        g._in(vec0.inputs[i], p[i])
    cells = g.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="F1", distance="EUCLIDEAN")
    nt.links.new(vec0.outputs[0], cells.inputs["Vector"])
    cells.inputs["Scale"].default_value = 0.45
    cells.inputs["Randomness"].default_value = 1.0
    tilt = g.node("ShaderNodeVectorMath", operation="SUBTRACT")
    nt.links.new(cells.outputs["Color"], tilt.inputs[0])
    tilt.inputs[1].default_value = (0.5, 0.5, 0.5)
    world = g.node("ShaderNodeVectorTransform", vector_type="VECTOR", convert_from="OBJECT", convert_to="WORLD")
    nt.links.new(tilt.outputs["Vector"], world.inputs[0])
    geo = g.node("ShaderNodeNewGeometry")
    bent = g.node("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
    nt.links.new(world.outputs[0], bent.inputs[0])
    bent.inputs[1].default_value = (0.9, 0.9, 0.9)
    nt.links.new(geo.outputs["Normal"], bent.inputs[2])
    unit = g.node("ShaderNodeVectorMath", operation="NORMALIZE")
    nt.links.new(bent.outputs["Vector"], unit.inputs[0])
    for name in ("Normal", "Coat Normal"):
        if name in bsdf.inputs:
            nt.links.new(unit.outputs["Vector"], bsdf.inputs[name])
    if not base_in.is_linked:
        return "crystal"
    src = base_in.links[0].from_socket
    vec = g.node("ShaderNodeCombineXYZ")
    for i in range(3):
        g._in(vec.inputs[i], p[i])
    veins = g.node("ShaderNodeTexWave", wave_type="RINGS", rings_direction="Z", wave_profile="SIN")
    nt.links.new(vec.outputs[0], veins.inputs["Vector"])
    veins.inputs["Scale"].default_value = 0.35
    veins.inputs["Distortion"].default_value = 6.0
    veins.inputs["Detail"].default_value = 2.0
    frost = g.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
    nt.links.new(veins.outputs["Factor"], frost.inputs["Value"])
    frost.inputs["From Min"].default_value, frost.inputs["From Max"].default_value = 0.9, 0.99
    lit = g.node("ShaderNodeVectorMath", operation="SCALE")
    nt.links.new(src, lit.inputs[0])
    g._in(lit.inputs["Scale"], g.add(1.0, g.mul(frost.outputs["Result"], 0.6)))
    nt.links.new(lit.outputs["Vector"], base_in)
    # (light inside: the faces turned to the viewer glow faintly in the crystal's color)
    facing = g.node("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.4
    glow = g.node("ShaderNodeVectorMath", operation="SCALE")
    nt.links.new(src, glow.inputs[0])
    g._in(glow.inputs["Scale"], g.mul(g.sub(1.0, facing.outputs["Facing"]), 0.35))
    nt.links.new(glow.outputs["Vector"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    return "crystal"


def weathered(g, nt, bsdf, p, zone, bevel=None):
    """Paint that has seen fights: mottled and grimy, flecked, scratched and chipped (lighter and greyer where the paint
    is gone, most of all on the edges), all in the part's coordinates; metal gets uneven polish, tarnish and fine
    scratches. Only brightness and saturation change (see the module). Features are no smaller than about two HD
    pixels, so they do not sparkle as the parts move from frame to frame."""
    base_in = bsdf.inputs["Base Color"]
    if not base_in.is_linked:
        return
    src = base_in.links[0].from_socket
    vec = g.node("ShaderNodeCombineXYZ")
    for i in range(3):
        g._in(vec.inputs[i], p[i])

    def noise(scale, detail=4.0, rough=0.55, w=0.0):
        n = g.node("ShaderNodeTexNoise", noise_dimensions="4D")
        nt.links.new(vec.outputs[0], n.inputs["Vector"])
        n.inputs["W"].default_value = w
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        return n.outputs["Factor"]

    def step(value, lo, hi):
        """0 below lo, 1 above hi (or the other way round when lo > hi), smoothly."""
        m = g.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        g._in(m.inputs["Value"], value)
        m.inputs["From Min"].default_value, m.inputs["From Max"].default_value = lo, hi
        return m.outputs["Result"]

    def lines(scale, direction, distortion, lo=0.955):
        """Thin scratches: the crests of a distorted wave."""
        wave = g.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction=direction, wave_profile="SIN")
        nt.links.new(vec.outputs[0], wave.inputs["Vector"])
        wave.inputs["Scale"].default_value = scale
        wave.inputs["Distortion"].default_value = distortion
        wave.inputs["Detail"].default_value = 3.0
        return step(wave.outputs["Factor"], lo, 0.99)

    # Edges: where the rounded normal (finish_materials' bevel) leaves the face's own.
    edge = 0.0
    if bevel is not None:
        geo = g.node("ShaderNodeNewGeometry")
        dot = g.node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        nt.links.new(bevel.outputs["Normal"], dot.inputs[0])
        nt.links.new(geo.outputs["Normal"], dot.inputs[1])
        edge = step(dot.outputs["Value"], 0.995, 0.95)
    rough = bsdf.inputs["Roughness"]
    rough_src = rough.links[0].from_socket if rough.is_linked else rough.default_value
    # Grime: darker patches where one noise is low.
    grime = step(noise(0.55, 3.0, 0.5, 13.7), 0.5, 0.36)
    shaded = g.node("ShaderNodeVectorMath", operation="SCALE")
    nt.links.new(src, shaded.inputs[0])
    if zone == "primary":
        # Mottling: large soft patches and a fine grain.
        mottle = g.add(g.mul(noise(0.32, 3.0, 0.5, 1.7), 0.22), g.mul(noise(2.6, 2.0, 0.5, 3.1), 0.1))
        g._in(shaded.inputs["Scale"], g.sub(g.add(0.84, mottle), g.mul(grime, 0.24)))
        # Paint gone: chips where one noise peaks, more of them on the edges, small flecks all over, scratches in
        # patches.
        chips = step(noise(1.3, 6.0, 0.65, 5.3), 0.665, 0.705)
        if edge != 0.0:
            chips = g.max(chips, g.mul(edge, step(noise(2.4, 4.0, 0.6, 19.1), 0.52, 0.6)))
        flecks = step(noise(2.8, 2.0, 0.5, 23.3), 0.69, 0.73)
        patches = g.below(noise(0.45, 2.0, 0.5, 7.9), 0.5, 0.15)
        scratches = g.mul(g.max(lines(1.9, "DIAGONAL", 9.0), lines(1.3, "X", 14.0, 0.965)), g.sub(1.0, patches))
        worn = g.clamp01(g.add(g.add(chips, g.mul(flecks, 0.7)), g.mul(scratches, 0.8)))
        # Worn: a lighter, greyer version of the same color.
        grey = g.node("ShaderNodeHueSaturation")
        grey.inputs["Saturation"].default_value = 0.55
        grey.inputs["Value"].default_value = 1.55
        nt.links.new(src, grey.inputs["Color"])
        mix = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MIX", clamp_result=True)
        g._in(mix.inputs[0], worn)
        nt.links.new(shaded.outputs["Vector"], mix.inputs[6])
        nt.links.new(grey.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], base_in)
        # (bare metal where the paint is gone: shinier; grime: duller)
        g._in(rough, g.clamp01(g.add(g.sub(rough_src, g.mul(worn, 0.3)), g.mul(grime, 0.12))))
    else:
        # Metal: uneven polish, tarnished patches, fine bright scratches.
        polish = noise(1.1, 5.0, 0.6, 11.3)
        tarnish = step(noise(0.6, 3.0, 0.55, 29.5), 0.56, 0.4)
        fine = lines(2.6, "DIAGONAL", 6.0, 0.965)
        scale = g.add(g.add(0.9, g.mul(polish, 0.2)), g.sub(g.mul(fine, 0.3), g.mul(g.max(tarnish, grime), 0.3)))
        g._in(shaded.inputs["Scale"], scale)
        nt.links.new(shaded.outputs["Vector"], base_in)
        g._in(rough, g.clamp01(g.add(g.add(0.12, g.mul(polish, 0.18)), g.mul(tarnish, 0.2))))


# ---- replacement geometry: where the HD pictures show more than the model's low-polygon shapes -----------------------

def helix_drill_mesh(steps=120, around=96, turns_per_unit=1 / 7.0, depth=0.15):
    """HELIX's drill as it is meant to look: a smooth cone with two spiral flutes, in the hand's frame (Blender axes:
    the drill points down -Z), the same length and taper as the model's six twisted sections (whose faceted outline
    it stays inside of, nearly filling it)."""
    import bmesh
    y0, y1 = -2.8, -29.2
    r0, r1 = 4.6, 0.25
    bm = bmesh.new()
    rings = []
    for i in range(steps + 1):
        t = i / steps
        yy = y0 + (y1 - y0) * t
        base = (r0 + (r1 - r0) * t) * 1.1
        ring = []
        for k in range(around):
            th = 2 * math.pi * k / around
            phase = 2 * (th - 2 * math.pi * yy * turns_per_unit)
            flute = (0.5 - 0.5 * math.cos(phase)) ** 1.6
            r = base * (1 - depth * flute)
            ring.append(bm.verts.new((r * math.cos(th) * U, r * math.sin(th) * U, yy * U)))
        rings.append(ring)
    for i in range(steps):
        a, b = rings[i], rings[i + 1]
        for k in range(around):
            bm.faces.new((a[k], a[(k + 1) % around], b[(k + 1) % around], b[k]))
    top = bm.verts.new((0, 0, y0 * U))
    for k in range(around):
        bm.faces.new((top, rings[0][(k + 1) % around], rings[0][k]))
    tip = bm.verts.new((0, 0, (y1 - 0.4) * U))
    last = rings[-1]
    for k in range(around):
        bm.faces.new((tip, last[k], last[(k + 1) % around]))
    bm.normal_update()
    me = bpy.data.meshes.new("HELIX drill")
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    return me


def replace_helix_drill(meshes):
    """Hides the drill's six sections and puts the smooth drill in their place, following the hand (its base part,
    handF.0, sits 1.4 units down the hand's axis). Returns the followers (object, source, offset)."""
    from mathutils import Matrix
    by = {ob.name: ob for ob in meshes}
    base = by.get("handF.0")
    sections = [by.get(f"handF.{i}") for i in range(1, 7)]
    if base is None or any(s is None for s in sections):
        return []
    for s in sections:
        s["omf_hidden"] = True
    drill = bpy.data.objects.new("HELIX drill", helix_drill_mesh())
    bpy.context.scene.collection.objects.link(drill)
    drill.data.materials.append(sections[0].material_slots[0].material)
    drill["omf"] = {"role": "part", "joint": "handF", "zone": "secondary"}
    return [(drill, base, Matrix.Translation((0, 0, 1.4 * U)))]


REPLACEMENTS = {"HELIX": replace_helix_drill}


def follow(followers):
    """Places the replacement objects for the frame the scene shows (and hides them with their source)."""
    for ob, src, offset in followers:
        ob.matrix_world = src.matrix_world @ offset
        ob.hide_render = src.hide_render


def detail_robot(meshes, robot, spec=None):
    """Detail on every part of the robot, and its replacement geometry; returns (parts detailed, followers)."""
    followers = REPLACEMENTS[robot](meshes) if robot in REPLACEMENTS else []
    done = 0
    for ob in meshes:
        if ob.get("omf_hidden"):
            continue
        if detail_object(ob, robot, spec) is not None:
            done += 1
    bpy.context.view_layer.update()
    return done, followers
