#!/usr/bin/env python3
"""
Build the acorn d6 for Dice So Nice: dice/acorn-d6.glb + scripts/acorn-shape.js

Coordinates: glTF / Dice So Nice convention, +Y up. The die's long axis is X
(+X = cap, -X = tip). It rests on one of the six body faces; the value read is
the face on top.

Units: the physics collider is authored in "collider units"; Dice So Nice
scales it by d6.scale (0.9) * TARGET_D6_EDGE, while a glTF model is scaled by
TARGET_D6_EDGE / 100. So 1 collider unit = 90 glTF units, and the visual
mesh is the collider geometry * 90 (plus decoration).

Everything here is generated (no external art): an original acorn-shaped die.
"""
import io, json, math, os, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import pygltflib as g

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_GLB = os.path.join(ROOT, "dice", "acorn-d6.glb")
OUT_JS = os.path.join(ROOT, "scripts", "acorn-shape.js")
PREVIEW = os.path.join(ROOT, "tools", "acorn", "preview")
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

rng = np.random.default_rng(7)

# ── Shape parameters (collider units, before global scale S) ────────────────
S = 0.85                       # overall size vs a standard d6
A = 0.55                       # apothem of the hexagonal body (reference)
R = A / math.cos(math.radians(30))   # corner radius (reference)
# Profile of the convex collider along the long axis: (x, corner radius / R).
# The body is a hexagonal frustum widening towards the cap (acorn-like); the
# six numbered faces are its sides. Radii must give a convex profile.
X_TIP, X_CAP = -1.02, 1.02                 # points
X_TIP_RING, K_TIP_RING = -0.80, 0.62       # ogive ring of the tip
X_TIP_BODY, K_TIP_BODY = -0.50, 0.94       # body starts (tip side)
X_CAP_BODY, K_CAP_BODY = 0.40, 1.04        # body ends, hidden under the cup
X_CAP_RING, K_CAP_RING = 0.72, 0.90        # ring under the cup dome
X_RIM = 0.26                               # visible rim of the cup
MODEL = 90.0 * S               # collider unit -> glTF unit (after S)

# Values around the ring (face k has outward normal at angle 60k deg in the YZ
# plane, k=0 -> +Y). Opposite faces (k, k+3) add up to 7, like a d6.
RING_VALUES = [3, 5, 1, 4, 2, 6]
for k in range(3):
    assert RING_VALUES[k] + RING_VALUES[k + 3] == 7

def face_angle(k):            # outward normal angle of body face k
    return math.radians(60 * k)

def corner_angle(j):          # corner j sits between faces j and j+1
    return math.radians(60 * j + 30)

def ring(x, r):
    return [(x, r * math.cos(corner_angle(j)), r * math.sin(corner_angle(j))) for j in range(6)]

# ── Collider ────────────────────────────────────────────────────────────────
def build_collider():
    V = []
    T2 = ring(X_TIP_BODY, R * K_TIP_BODY); C1 = ring(X_CAP_BODY, R * K_CAP_BODY)
    T1 = ring(X_TIP_RING, R * K_TIP_RING); C2 = ring(X_CAP_RING, R * K_CAP_RING)
    def add(pts):
        i0 = len(V); V.extend(pts); return list(range(i0, i0 + len(pts)))
    iT2, iC1, iT1, iC2 = add(T2), add(C1), add(T1), add(C2)
    iTip = add([(X_TIP, 0, 0)])[0]; iCap = add([(X_CAP, 0, 0)])[0]
    V = np.array(V) * S
    faces, values = [], []
    for k in range(6):          # body face k spans corners k-1 and k
        a, b = (k - 1) % 6, k
        faces.append([iT2[a], iT2[b], iC1[b], iC1[a]]); values.append(RING_VALUES[k])
    for k in range(6):
        a, b = (k - 1) % 6, k
        faces.append([iT1[a], iT1[b], iT2[b], iT2[a]]); values.append(0)
        faces.append([iTip, iT1[b], iT1[a]]); values.append(0)
        faces.append([iC1[a], iC1[b], iC2[b], iC2[a]]); values.append(0)
        faces.append([iCap, iC2[a], iC2[b]]); values.append(0)
    # counter-clockwise seen from outside (outward normals)
    centroid = V.mean(axis=0)
    fixed = []
    for f in faces:
        p = V[f]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if np.dot(n, p.mean(axis=0) - centroid) < 0:
            f = list(reversed(f))
        fixed.append(f)
    # sanity: convex (every vertex behind every face plane)
    for f in fixed:
        p = V[f]; n = np.cross(p[1] - p[0], p[2] - p[0]); n /= np.linalg.norm(n)
        d = (V - p[0]) @ n
        assert d.max() < 1e-9, ("not convex", f, d.max())
        # planar faces
        assert np.abs((p - p[0]) @ n).max() < 1e-9, ("non planar", f)
    # body face normals point (in the YZ plane) at face_angle(k)
    for k in range(6):
        p = V[fixed[k]]; n = np.cross(p[1] - p[0], p[2] - p[0]); n /= np.linalg.norm(n)
        yz = n[1:] / np.linalg.norm(n[1:])
        assert np.allclose(yz, [math.cos(face_angle(k)), math.sin(face_angle(k))], atol=1e-9), (k, n)
        assert n[0] < 0 and abs(n[0]) < 0.12, ("taper", k, n)
    return V, fixed, values

def rotation_table():
    """Key "lo,hi": Euler XYZ degrees R with R * n(hi) = n(lo) (checked against
    the built-in d6 table of Dice So Nice). A rotation about the long axis X,
    which is a symmetry of the solid."""
    ang = {RING_VALUES[k]: 60 * k for k in range(6)}
    table = {}
    for lo in range(1, 7):
        for hi in range(lo + 1, 7):
            th = (ang[lo] - ang[hi]) % 360
            if th > 180: th -= 360
            table[f"{lo},{hi}"] = [float(th), 0.0, 0.0]
    return table

# ── Textures ────────────────────────────────────────────────────────────────
TEX = 1024
PANEL_W, PANEL_H = 512, 320          # one body face (u along X, v across)
STRIP_Y = 3 * PANEL_H                # plain wood strip for the tip

def wood_texture():
    h, w = TEX, TEX
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    # grain runs along u (the die's long axis)
    n1 = np.zeros((h, w), np.float32)
    for f, a in [(3, 1.0), (7, 0.5), (17, 0.25), (41, 0.12)]:
        ph = rng.uniform(0, 6.28, 4)
        n1 += a * np.sin(y / h * 6.28 * f + 1.8 * np.sin(x / w * 6.28 * (f / 6) + ph[0]) + ph[1])
    n1 = (n1 - n1.min()) / (n1.max() - n1.min())
    fine = rng.normal(0, 1, (h // 4, w // 4)).astype(np.float32)
    fine = np.array(Image.fromarray(((fine - fine.min()) / (np.ptp(fine)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.2))) / 255.0
    t = 0.7 * n1 + 0.3 * fine
    dark = np.array([58, 27, 14], np.float32); light = np.array([108, 54, 29], np.float32)
    col = dark[None, None] * (1 - t[..., None]) + light[None, None] * t[..., None]
    return col

# Carved numerals: original angular stroke glyphs in a unit box (x right, y down)
GLYPHS = {
    1: [[(0.32, 0.30), (0.55, 0.08), (0.55, 0.92)], [(0.33, 0.92), (0.77, 0.92)]],
    2: [[(0.22, 0.28), (0.40, 0.10), (0.68, 0.10), (0.80, 0.28), (0.24, 0.90), (0.82, 0.90)]],
    3: [[(0.22, 0.10), (0.78, 0.10), (0.46, 0.44), (0.66, 0.48), (0.80, 0.66), (0.66, 0.88), (0.40, 0.92), (0.20, 0.80)]],
    4: [[(0.64, 0.92), (0.64, 0.08), (0.16, 0.66), (0.86, 0.66)]],
    5: [[(0.78, 0.10), (0.30, 0.10), (0.25, 0.46), (0.58, 0.42), (0.80, 0.58), (0.76, 0.82), (0.52, 0.93), (0.20, 0.84)]],
    6: [[(0.70, 0.08), (0.36, 0.38), (0.22, 0.66), (0.32, 0.88), (0.56, 0.93), (0.78, 0.76), (0.70, 0.54), (0.46, 0.50), (0.25, 0.64)]],
}

def numeral_mask(value, size=(PANEL_W, PANEL_H)):
    """Mask (0..1) of the numeral for one face panel. Digit 'up' points to +u
    (towards the cap): the glyph is drawn upright, then rotated."""
    gh, gw = 230, 160                 # glyph box: height along the die axis
    pad = 24
    tile = Image.new("L", (gw + 2 * pad, gh + 2 * pad), 0)
    d = ImageDraw.Draw(tile)
    width = 17
    for stroke in GLYPHS[value]:
        pts = [(pad + px * gw, pad + py * gh) for px, py in stroke]
        d.line(pts, fill=255, width=width, joint="curve")
        for p in pts:
            d.ellipse([p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2], fill=255)
    tile = tile.rotate(-90, expand=True)      # top of the glyph -> +u (right)
    panel = Image.new("L", size, 0)
    cx = int(0.43 * size[0]); cy = size[1] // 2
    panel.paste(tile, (cx - tile.width // 2, cy - tile.height // 2))
    return np.array(panel, np.float32) / 255.0

def build_textures():
    base = wood_texture()
    height = np.ones((TEX, TEX), np.float32)        # 1 = surface, lower = carved
    metal = np.zeros((TEX, TEX), np.float32)
    rough = np.full((TEX, TEX), 0.62, np.float32)
    gold = np.array([226, 172, 72], np.float32)
    gold_dark = np.array([150, 96, 28], np.float32)
    for k, val in enumerate(RING_VALUES):
        col, row = k % 2, k // 2
        x0, y0 = col * PANEL_W, row * PANEL_H
        m = numeral_mask(val)
        soft = np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.2)), np.float32) / 255
        rim = np.clip(soft - m, 0, 1)                 # darker carved edge
        sl = (slice(y0, y0 + PANEL_H), slice(x0, x0 + PANEL_W))
        shade = np.clip(m * 0.85 + 0.15, 0, 1)
        g_col = gold_dark[None, None] * (1 - shade[..., None]) + gold[None, None] * shade[..., None]
        base[sl] = base[sl] * (1 - m[..., None]) + g_col * m[..., None]
        base[sl] *= (1 - 0.45 * rim)[..., None]
        height[sl] -= 0.9 * soft
        metal[sl] = np.maximum(metal[sl], m)
        rough[sl] = rough[sl] * (1 - m) + 0.32 * m
        # faint facet edge darkening (worn wood)
        edge = np.ones((PANEL_H, PANEL_W), np.float32)
        yy, xx = np.mgrid[0:PANEL_H, 0:PANEL_W]
        dist = np.minimum.reduce([yy, PANEL_H - 1 - yy]).astype(np.float32)
        edge = np.clip(dist / 18.0, 0, 1) * 0.25 + 0.75
        base[sl] *= edge[..., None]
    # normal map from height (tangent space: +R = +u, +G = image up)
    hgt = np.array(Image.fromarray((np.clip(height, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    dx = np.zeros_like(hgt); dy = np.zeros_like(hgt)
    dx[:, 1:-1] = (hgt[:, 2:] - hgt[:, :-2]) * 0.5
    dy[1:-1, :] = (hgt[2:, :] - hgt[:-2, :]) * 0.5
    strength = 6.0
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(hgt)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    nmap = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    mr = np.stack([np.zeros_like(rough), rough, metal], -1)   # glTF: G=roughness, B=metalness
    to_img = lambda a: Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return to_img(base), to_img(nmap * 255), to_img(mr * 255)

# ── Visual mesh ─────────────────────────────────────────────────────────────
class Prim:
    def __init__(self):
        self.P, self.N, self.UV, self.C, self.I = [], [], [], [], []
    def vert(self, p, n, uv=(0, 0), c=None):
        self.P.append(p); self.N.append(n); self.UV.append(uv)
        if c is not None: self.C.append(c)
        return len(self.P) - 1
    def tri(self, a, b, c): self.I += [a, b, c]

def unit(v):
    v = np.asarray(v, float); return v / np.linalg.norm(v)

def build_wood(prim):
    """Six numbered body faces (flat) + the faceted ogive tip."""
    T2 = np.array(ring(X_TIP_BODY, R * K_TIP_BODY)); C1 = np.array(ring(X_CAP_BODY, R * K_CAP_BODY))
    for k in range(6):
        a, b = (k - 1) % 6, k
        n = unit(np.cross(C1[b] - T2[b], T2[a] - T2[b]))
        if np.dot(n, [0, math.cos(face_angle(k)), math.sin(face_angle(k))]) < 0: n = -n
        t = np.array([1.0, 0, 0])                 # u along +X
        bvec = np.cross(n, t)                      # image up
        col, row = k % 2, k // 2
        u0, v0 = col * PANEL_W / TEX, row * PANEL_H / TEX
        du, dv = PANEL_W / TEX, PANEL_H / TEX
        quad = [T2[a], T2[b], C1[b], C1[a]]
        idx = []
        for p in quad:
            s = (p[0] - X_TIP_BODY) / (X_CAP_BODY - X_TIP_BODY)          # 0..1 along u
            half = abs(np.dot(p - np.array([p[0], 0, 0]), bvec))
            w = 0.5 + 0.5 * np.sign(np.dot(p - np.array([p[0], 0, 0]), bvec))  # 0 (down) .. 1 (up)
            uv = (u0 + s * du, v0 + (1 - w) * dv)
            idx.append(prim.vert(p * MODEL, n, uv))
        # winding: outward
        pa, pb, pc = [np.array(prim.P[i]) for i in idx[:3]]
        if np.dot(np.cross(pb - pa, pc - pa), n) < 0: idx = idx[::-1]
        prim.tri(idx[0], idx[1], idx[2]); prim.tri(idx[0], idx[2], idx[3])
    # tip: two bands, flat shaded, plain wood strip
    T1 = np.array(ring(X_TIP_RING, R * K_TIP_RING)); tip = np.array([X_TIP, 0, 0])
    strip_v0, strip_v1 = (STRIP_Y + 4) / TEX, (TEX - 4) / TEX
    def flat(poly):
        poly = [np.array(p) for p in poly]
        n = unit(np.cross(poly[1] - poly[0], poly[2] - poly[0]))
        if np.dot(n, np.mean(poly, axis=0) - np.array([-0.3, 0, 0])) < 0:
            poly = poly[::-1]; n = -n
        ids = []
        for p in poly:
            uv = (0.05 + 0.9 * (p[0] - X_TIP) / (X_TIP_BODY - X_TIP), strip_v0 + (strip_v1 - strip_v0) * (0.5 + 0.5 * math.atan2(p[2], p[1]) / math.pi))
            ids.append(prim.vert(p * MODEL, n, uv))
        for i in range(1, len(ids) - 1): prim.tri(ids[0], ids[i], ids[i + 1])
    for k in range(6):
        a, b = (k - 1) % 6, k
        flat([T1[a], T1[b], T2[b], T2[a]])
        flat([tip, T1[b], T1[a]])

def cup_bump(theta, s, rows=8, per_row=16):
    """Knobbly acorn-cup scales: rows of rounded knobs, offset every other row.
    theta: 0..2pi around the axis; s: 0 (rim) .. 1 (stem). Returns (bump 0..1, cell edge 0..1)."""
    r = s * rows
    row = np.floor(r)
    fr = r - row
    off = (row % 2) * 0.5
    c = theta / (2 * np.pi) * per_row * (1 - 0.45 * s) + off
    fc = c - np.floor(c)
    d = np.sqrt(((fc - 0.5) * 2) ** 2 + ((fr - 0.5) * 2) ** 2)
    bump = np.clip(1 - d ** 2, 0, 1) ** 0.7
    return bump, np.clip(d, 0, 1)

def srgb_to_linear(c):
    c = np.clip(np.asarray(c, float), 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def body_k(x):
    """Corner-radius factor of the body frustum at x (collider profile)."""
    t = (x - X_TIP_BODY) / (X_CAP_BODY - X_TIP_BODY)
    return K_TIP_BODY + (K_CAP_BODY - K_TIP_BODY) * t

def build_cap(prim):
    """Knobbly cup over the cap end + short stem (vertex colours).
    Cross-section: the body's hexagon with softened corners, so the cup wraps
    the faceted body and stays (almost) inside the collider."""
    NT, NS = 96, 36
    x0, xb, x1 = X_RIM, X_CAP_BODY, X_CAP - 0.06
    f_rim = body_k(x0) * 1.04
    f_max = K_CAP_BODY * 1.03
    def factor(s):                     # s 0..1 rim -> top; corner-radius factor
        x = x0 + (x1 - x0) * s
        if x <= xb:                    # rim -> widest point
            t = (x - x0) / (xb - x0)
            return x, f_rim + (f_max - f_rim) * math.sin(t * math.pi / 2)
        t = (x - xb) / (x1 - xb)       # elliptical dome
        return x, f_max * math.sqrt(max(0.0, 1 - t ** 2.2))
    def section(th):                   # softened hexagon (1 at corners)
        d = ((th - math.radians(30)) % math.radians(60)) - math.radians(30)   # angle from nearest face normal
        return (math.cos(math.radians(30)) / math.cos(d)) ** 0.55
    grid = []
    for i in range(NS + 1):
        s = i / NS
        x, f = factor(s)
        row = []
        for j in range(NT):
            th = 2 * math.pi * j / NT
            su = min(max((s - 0.03) / 0.92, 0), 0.999)
            bump, edge = cup_bump(np.array(th), np.array(su))
            bump, edge = float(bump), float(edge)
            amp = 0.0 if s > 0.94 else 0.05
            rr = f * R * section(th) + amp * bump * R * (1 - 0.4 * s)
            p = np.array([x + 0.015 * bump * (1 - s), rr * math.cos(th), rr * math.sin(th)])
            light = np.array([0.55, 0.36, 0.21]); mid = np.array([0.36, 0.21, 0.12]); dark = np.array([0.16, 0.09, 0.05])
            c = mid * (1 - bump) + light * bump
            c = c * (1 - 0.7 * edge ** 6) + dark * 0.7 * edge ** 6
            c = c * (0.92 + 0.16 * rng.random())
            row.append((p, np.append(srgb_to_linear(c), 1.0)))
        grid.append(row)
    P = np.array([[c[0] for c in row] for row in grid])
    ids = np.zeros((NS + 1, NT), int)
    for i in range(NS + 1):
        for j in range(NT):
            pu = P[min(i + 1, NS), j] - P[max(i - 1, 0), j]
            pv = P[i, (j + 1) % NT] - P[i, (j - 1) % NT]
            n = np.cross(pu, pv)
            n = unit(n) if np.linalg.norm(n) > 1e-12 else np.array([1.0, 0, 0])
            radial = P[i, j] - np.array([P[i, j][0], 0, 0])
            if np.dot(n, radial) + n[0] * 0.5 < 0: n = -n
            ids[i, j] = prim.vert(P[i, j] * MODEL, n, (0, 0), list(grid[i][j][1]))
    for i in range(NS):
        for j in range(NT):
            a, b, c, d = ids[i, j], ids[i, (j + 1) % NT], ids[i + 1, (j + 1) % NT], ids[i + 1, j]
            prim.tri(a, c, b); prim.tri(a, d, c)
    top = prim.vert(np.array([x1 + 0.004, 0, 0]) * MODEL, [1, 0, 0], (0, 0), list(srgb_to_linear([0.30, 0.17, 0.09])) + [1])
    for j in range(NT):
        prim.tri(ids[NS, j], top, ids[NS, (j + 1) % NT])
    # underside of the rim (thickness of the cup), tucked against the body
    inner = []
    fin = body_k(x0) * 0.99
    for j in range(NT):
        th = 2 * math.pi * j / NT
        rr = fin * R * section(th) * 0.97
        p = np.array([x0 + 0.012, rr * math.cos(th), rr * math.sin(th)])
        inner.append(prim.vert(p * MODEL, [-1, 0, 0], (0, 0), list(srgb_to_linear([0.20, 0.11, 0.06])) + [1]))
    for j in range(NT):
        a, b = ids[0, j], ids[0, (j + 1) % NT]
        prim.tri(a, b, inner[(j + 1) % NT]); prim.tri(a, inner[(j + 1) % NT], inner[j])
    # stem: short tapered stalk, slightly bent
    SN = 8
    def sring(x, r, dy):
        return [np.array([x, dy + r * math.cos(2 * math.pi * j / SN), r * math.sin(2 * math.pi * j / SN)]) for j in range(SN)]
    rings = [(sring(x1 - 0.03, 0.075, 0.0), 0.0), (sring(x1 + 0.05, 0.062, 0.012), 0.012), (sring(x1 + 0.11, 0.052, 0.03), 0.03)]
    col = list(srgb_to_linear([0.30, 0.17, 0.09])) + [1]
    rid = []
    for rg, dy in rings:
        rid.append([prim.vert(p * MODEL, unit([0, p[1] - dy, p[2]]), (0, 0), col) for p in rg])
    for a_ring, b_ring in zip(rid[:-1], rid[1:]):
        for j in range(SN):
            a, b, c, d = a_ring[j], a_ring[(j + 1) % SN], b_ring[(j + 1) % SN], b_ring[j]
            prim.tri(a, b, c); prim.tri(a, c, d)
    endc = prim.vert(np.array([x1 + 0.12, 0.03, 0]) * MODEL, [1, 0, 0], (0, 0), list(srgb_to_linear([0.38, 0.24, 0.13])) + [1])
    for j in range(SN):
        prim.tri(rid[-1][j], rid[-1][(j + 1) % SN], endc)

def fix_winding(prim):
    """Make every triangle face the way its vertex normals point."""
    P = np.array(prim.P); N = np.array(prim.N); I = np.array(prim.I).reshape(-1, 3)
    for t in range(len(I)):
        a, b, c = I[t]
        fn = np.cross(P[b] - P[a], P[c] - P[a])
        if np.dot(fn, N[a] + N[b] + N[c]) < 0:
            I[t] = [a, c, b]
    prim.I = I.reshape(-1).tolist()

# ── glTF writer ─────────────────────────────────────────────────────────────
def write_glb(prims, images, path):
    blob = bytearray(); views = []; accessors = []
    def add_view(data, target=None):
        while len(blob) % 4: blob.append(0)
        off = len(blob); blob.extend(data)
        views.append(g.BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        return len(views) - 1
    def add_acc(arr, ctype, typ, target, minmax=False):
        v = add_view(arr.tobytes(), target)
        a = g.Accessor(bufferView=v, componentType=ctype, count=len(arr), type=typ)
        if minmax: a.min = arr.min(axis=0).tolist(); a.max = arr.max(axis=0).tolist()
        accessors.append(a); return len(accessors) - 1
    gl_images, textures = [], []
    for img, mime in images:
        buf = io.BytesIO()
        img.save(buf, format="JPEG" if mime == "image/jpeg" else "PNG", **({"quality": 90} if mime == "image/jpeg" else {"optimize": True}))
        v = add_view(buf.getvalue())
        gl_images.append(g.Image(bufferView=v, mimeType=mime))
        textures.append(g.Texture(sampler=0, source=len(gl_images) - 1))
    materials = [
        g.Material(name="AcornWood",
                   pbrMetallicRoughness=g.PbrMetallicRoughness(
                       baseColorTexture=g.TextureInfo(index=0), metallicRoughnessTexture=g.TextureInfo(index=2),
                       metallicFactor=1.0, roughnessFactor=1.0),
                   normalTexture=g.NormalMaterialTexture(index=1, scale=1.0)),
        g.Material(name="AcornCup",
                   pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorFactor=[1, 1, 1, 1], metallicFactor=0.0, roughnessFactor=0.8)),
    ]
    gprims = []
    for mi, pr in enumerate(prims):
        P = np.array(pr.P, np.float32); N = np.array(pr.N, np.float32)
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        attrs = g.Attributes(POSITION=add_acc(P, g.FLOAT, g.VEC3, g.ARRAY_BUFFER, True),
                             NORMAL=add_acc(N, g.FLOAT, g.VEC3, g.ARRAY_BUFFER))
        if mi == 0:
            attrs.TEXCOORD_0 = add_acc(np.array(pr.UV, np.float32), g.FLOAT, g.VEC2, g.ARRAY_BUFFER)
        if pr.C:
            attrs.COLOR_0 = add_acc(np.array(pr.C, np.float32), g.FLOAT, g.VEC4, g.ARRAY_BUFFER)
        I = np.array(pr.I, np.uint32 if len(pr.P) > 65535 else np.uint16)
        ind = add_acc(I, g.UNSIGNED_INT if I.dtype == np.uint32 else g.UNSIGNED_SHORT, g.SCALAR, g.ELEMENT_ARRAY_BUFFER)
        gprims.append(g.Primitive(attributes=attrs, indices=ind, material=mi))
    while len(blob) % 4: blob.append(0)
    gltf = g.GLTF2(
        asset=g.Asset(version="2.0", generator="mist-hud-litm acorn builder"),
        scene=0, scenes=[g.Scene(nodes=[0])],
        nodes=[g.Node(name="AcornD6", mesh=0)],
        meshes=[g.Mesh(name="AcornD6", primitives=gprims)],
        materials=materials, textures=textures, images=gl_images,
        samplers=[g.Sampler(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071)],
        accessors=accessors, bufferViews=views, buffers=[g.Buffer(byteLength=len(blob))])
    gltf.set_binary_blob(bytes(blob))
    gltf.save_binary(path)

def main():
    V, F, vals = build_collider()
    rot = rotation_table()
    base, nmap, mr = build_textures()
    base.save(os.path.join(PREVIEW, "wood-base.png")); nmap.save(os.path.join(PREVIEW, "wood-normal.png"))
    wood, cup = Prim(), Prim()
    build_wood(wood); build_cap(cup); fix_winding(cup); fix_winding(wood)
    write_glb([wood, cup], [(base, "image/jpeg"), (nmap.resize((512, 512)) if False else nmap, "image/png"), (mr.resize((512, 512)), "image/png")], OUT_GLB)
    shape = {
        "name": "mist-hud-litm.acorn",
        "type": "ConvexPolyhedron",
        "vertices": [[round(float(c), 6) for c in v] for v in V],
        "faces": F,
        "skipLastFaceIndex": False,
        "faceValues": vals,
        "rotationCombinations": rot,
    }
    with open(OUT_JS, "w") as f:
        f.write("// acorn-shape.js — GENERATED by tools/acorn/build_acorn.py. Do not edit by hand.\n")
        f.write("// Physics collider of the acorn d6 for Dice So Nice (addDiceShape).\n")
        f.write("export const ACORN_SHAPE = " + json.dumps(shape) + ";\n")
    tris = (len(wood.I) + len(cup.I)) // 3
    print(f"glb {os.path.getsize(OUT_GLB)/1024:.0f} KB, {len(wood.P)+len(cup.P)} verts, {tris} tris; collider {len(V)} verts {len(F)} faces")
    print("extent (glTF units):", np.array(wood.P + cup.P).min(axis=0).round(1), np.array(wood.P + cup.P).max(axis=0).round(1))

if __name__ == "__main__":
    main()
