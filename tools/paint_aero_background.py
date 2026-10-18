"""Paints assets/aero/scene.webp, the Frutiger Aero background (sky over water, underwater light and grass).
Everything is generated here, no outside images. Run: python3 tools/paint_aero_background.py assets/aero/scene.webp /tmp/preview.jpg
Everything is generated here (no outside images). Writes a WebP and a JPEG preview."""
import sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, map_coordinates, zoom

rng = np.random.default_rng(11)
W, H = 1920, 1200
WL = int(H * 0.47)                      # water line
SUN = (int(W * 0.76), int(H * 0.09))

def noise(h, w, scale, seed):
    """Smooth value noise: random grid upscaled with cubic interpolation."""
    r = np.random.default_rng(seed)
    gh, gw = int(h / scale) + 4, int(w / scale) + 4
    g = r.random((gh, gw))
    z = zoom(g, ((h + 1) / (gh - 3), (w + 1) / (gw - 3)), order=3)
    return z[:h, :w]

def fbm(h, w, base, octaves, seed, gain=.5):
    out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(octaves):
        out += amp * noise(h, w, base / (2 ** o), seed + o * 17); tot += amp; amp *= gain
    return out / tot

def lerp(a, b, t): return a + (b - a) * t
def col(hexs): return np.array([int(hexs[i:i+2], 16) for i in (1, 3, 5)], float) / 255
yy, xx = np.mgrid[0:H, 0:W].astype(float)

# ── Sky ───────────────────────────────────────────────────────────────────
t = np.clip(yy / WL, 0, 1)[..., None]
sky = lerp(col("#0b55c4"), col("#3f98ec"), np.clip(t * 1.6, 0, 1)) * (t < .62) + lerp(col("#3f98ec"), col("#b9e3ff"), np.clip((t - .62) / .38, 0, 1)) * (t >= .62)
# sun glow
d = np.hypot(xx - SUN[0], yy - SUN[1])[..., None]
sky = sky + col("#ffffff") * (np.exp(-(d / 45) ** 2) * 1.0 + np.exp(-(d / 200) ** 2) * .28) + col("#fff4dd") * np.exp(-(d / 700) ** 2) * .1

# clouds: soft cumulus. Domain-warped noise gives billowy shapes; lighting comes from how much
# cloud sits above/below each point (bellies shaded blue-gray, tops bright white).
wx = (fbm(H, W, 400, 3, 51) - .5) * 160; wy = (fbm(H, W, 400, 3, 57) - .5) * 90
n = map_coordinates(fbm(H, W, 600, 6, 3, gain=.55), [np.clip(yy + wy, 0, H - 1), np.clip(xx + wx, 0, W - 1)], order=1)
band = np.clip(1 - np.abs(yy / WL - .5) / .55, 0, 1) ** 1.1
fine = fbm(H, W, 70, 4, 63)
dens = np.clip((n + (fine - .5) * .22 - .53 + band * .2) * 7.0, 0, 1) * (yy < WL - 8)
dens = gaussian_filter(dens, 1.6)
D = gaussian_filter(dens, 10)
belly = np.clip((np.roll(D, 34, axis=0) - D) * 3.5, 0, 1)        # cloud above this point -> it's an underside
top = np.clip((np.roll(D, -26, axis=0) - D) * -3.0, 0, 1)        # cloud below -> it's a lit top edge
sunward = np.exp(-(d[..., 0] / 520) ** 2)
cloud_col = col("#ffffff")[None, None] * (0.97 + top[..., None] * .06) 
cloud_col = lerp(cloud_col, col("#b8cce2"), (belly * (1 - sunward * .6))[..., None] * .45)
cloud_col = cloud_col + col("#fff3d6") * sunward[..., None] * .06
inner = gaussian_filter(dens, 22)[..., None]                       # thick middles a touch darker
cloud_col = cloud_col * (1 - np.clip(inner - .6, 0, .4) * .08)
a = np.clip(dens * 1.15, 0, 1)[..., None] ** .9
sky = sky * (1 - a) + cloud_col * a
img = np.where((yy < WL)[..., None], sky, 0)

# ── Underwater ────────────────────────────────────────────────────────────
u = np.clip((yy - WL) / (H - WL), 0, 1)[..., None]
water = lerp(col("#48c2ee"), col("#1a7fd0"), np.clip(u * 1.4, 0, 1))
water = lerp(water, col("#0b4f9e"), np.clip((u - .55) * 1.6, 0, 1))
# light shafts fanning down from where the sun hits the surface
ang = np.arctan2(xx - SUN[0] * .9, yy - (WL - 420))
shaft = fbm(1, 2400, 34, 4, 21)[0]
idx = np.clip(((ang + 1.2) / 2.4 * 2399).astype(int), 0, 2399)
rays = np.clip((shaft[idx] - .45) * 2.2, 0, 1) * np.exp(-((yy - WL) / 420)) * (yy >= WL)
rays = gaussian_filter(rays, 6)
water = water + col("#d8fbff") * rays[..., None] * .3
# rippled light on the underside of the surface (total internal reflection)
rip = fbm(H, W, 46, 3, 31); rip2 = fbm(H, W, 22, 2, 37)
caus = np.clip(1 - np.abs(rip - .5) * 9, 0, 1) * np.clip(1 - np.abs(rip2 - .5) * 7, 0, 1) * .6 + np.clip(1 - np.abs(rip - .5) * 5, 0, 1) * .25
under = np.exp(-((yy - WL) / 70)) * (yy >= WL)
squash = map_coordinates(caus, [WL + (yy - WL) * 3.2 % (H - WL), xx], order=1, mode="wrap")
water = water + col("#e9fdff") * (squash * under)[..., None] * .7
# floating specks
specks = (rng.random((H, W)) > .9993) * (yy > WL + 30)
specks = gaussian_filter(specks.astype(float), .8) * 6
water = water + col("#ffffff") * np.clip(specks, 0, .6)[..., None] * (1 - u * .6)
img = np.where((yy >= WL)[..., None], water, img)

# distant fish: soft dark shapes fading into the blue
fishes = Image.new("L", (W, H), 0); fd = ImageDraw.Draw(fishes)
for k in range(14):
    cx = rng.uniform(.15, .95) * W; cy = rng.uniform(WL + 90, WL + 380); s = rng.uniform(6, 15) * (1 if k > 4 else 2.2)
    if k <= 4: cx = [W*.33, W*.42, W*.62, W*.7, W*.55][k]; cy = [WL+170, WL+240, WL+150, WL+300, WL+330][k]
    dirn = 1 if rng.random() > .5 else -1
    fd.ellipse([cx - s * 2.2, cy - s * .7, cx + s * 2.2, cy + s * .7], fill=255)
    fd.polygon([(cx - dirn * s * 2.0, cy), (cx - dirn * s * 3.3, cy - s * .9), (cx - dirn * s * 3.0, cy), (cx - dirn * s * 3.3, cy + s * .9)], fill=255)
fm = gaussian_filter(np.asarray(fishes, float) / 255, 2.2)[..., None]
img = img * (1 - fm * .32) + col("#145a96") * fm * .32

# ── Water surface seen from the side ──────────────────────────────────────
wave = (np.sin(xx / 95) * 5 + np.sin(xx / 37 + 1.3) * 2.2 + (fbm(1, W, 60, 3, 41)[0][None, :] - .5) * 10)
dist = yy - (WL + wave)
# band just above the line: the far water seen almost edge-on, reflecting sky
above = np.clip(1 - np.abs(dist + 9) / 11, 0, 1)[..., None]
img = img * (1 - above * .75) + lerp(col("#9fdcff"), col("#e3f7ff"), np.clip(-(dist + 9) / 11 + .5, 0, 1)[..., None]) * above * .75
# the meniscus: a bright thin line and a darker band under it
line = np.exp(-(dist / 1.6) ** 2)[..., None]; img = img + line * .75
dark = np.clip(1 - np.abs(dist - 7) / 6, 0, 1)[..., None]; img = img * (1 - dark * .18)
# a mirrored, wavy copy of the light under the surface
mir = np.clip(1 - (dist - 10) / 40, 0, 1) * (dist > 10)
img = img + col("#cdf6ff") * (mir * (squash * .5 + .3))[..., None] * .35

img = np.clip(img, 0, 1)
base = Image.fromarray((img * 255).astype(np.uint8))

# ── Grass: thousands of blades in layers, far ones tinted by the water ────
def blade_layer(count, hmin, hmax, wmin, wmax, base_y, haze, blur, seed, light=1.0):
    r = np.random.default_rng(seed)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dr = ImageDraw.Draw(layer)
    order = r.permutation(count)
    for i in order:
        x = r.uniform(-40, W + 40); h = r.uniform(hmin, hmax); w = r.uniform(wmin, wmax)
        lean = r.normal(0, .28) * h; bend = r.uniform(.3, .7)
        y0 = base_y + r.uniform(-10, 30)
        g = r.uniform(.0, 1)
        dark = np.array([lerp(28, 52, g), lerp(84, 120, g), lerp(18, 30, g)])
        tip = np.array([lerp(120, 190, g), lerp(190, 236, g), lerp(60, 110, g)]) * light
        segs = 9
        pts_l, pts_r = [], []
        for s in range(segs + 1):
            f = s / segs
            cx = x + lean * (f ** (1 + bend)); cy = y0 - h * f
            ww = w * (1 - f) ** .8
            pts_l.append((cx - ww, cy)); pts_r.append((cx + ww, cy))
        for s in range(segs):
            f = (s + .5) / segs
            c = dark + (tip - dark) * (f ** .8)
            c = c * (1 - haze) + np.array([40, 140, 205]) * haze      # water haze
            # lit edge vs shaded edge
            cl = tuple(int(v) for v in np.clip(c * 1.08, 0, 255)); cr = tuple(int(v) for v in np.clip(c * .82, 0, 255))
            mx0 = ((pts_l[s][0] + pts_r[s][0]) / 2, pts_l[s][1]); mx1 = ((pts_l[s+1][0] + pts_r[s+1][0]) / 2, pts_l[s+1][1])
            dr.polygon([pts_l[s], mx0, mx1, pts_l[s+1]], fill=cl + (255,))
            dr.polygon([mx0, pts_r[s], pts_r[s+1], mx1], fill=cr + (255,))
    if blur: layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return layer

GROUND = H + 10
base = base.convert("RGBA")
# a soft green floor so gaps between blades aren't blue
floor = Image.new("RGBA", (W, H), (0, 0, 0, 0)); fdr = ImageDraw.Draw(floor)
fdr.rectangle([0, H - 150, W, H], fill=(38, 110, 70, 255)); floor = floor.filter(ImageFilter.GaussianBlur(40))
base = Image.alpha_composite(base, floor)
base = Image.alpha_composite(base, blade_layer(1400, 70, 180, 2, 4.5, H - 120, .55, 1.4, 1, .9))
base = Image.alpha_composite(base, blade_layer(1300, 120, 260, 3, 6.5, H - 60, .3, .7, 2))
base = Image.alpha_composite(base, blade_layer(900, 170, 360, 4, 9, GROUND, .1, 0, 3))
base = Image.alpha_composite(base, blade_layer(12, 360, 560, 12, 22, GROUND + 30, .05, 7, 4, 1.05))   # out-of-focus near blades

# bubbles: thin bright rims with a highlight, a couple of rising trails
bub = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bub)
def bubble(x, y, r):
    bd.ellipse([x - r, y - r, x + r, y + r], fill=(220, 245, 255, 28), outline=(240, 252, 255, 170), width=max(1, int(r / 7)))
    bd.ellipse([x - r * .55, y - r * .6, x - r * .15, y - r * .25], fill=(255, 255, 255, 210))
for cx in [W * .44, W * .52, W * .6]:
    for k in range(45):
        y = rng.uniform(WL + 40, H - 120); s = (H - y) / H
        bubble(cx + rng.normal(0, 14 + 60 * s) + math.sin(y / 30) * 10, y, rng.uniform(2.5, 4 + 12 * s))
for k in range(60):
    bubble(rng.uniform(0, W), rng.uniform(WL + 50, H - 200), rng.uniform(2, 6))
bub = bub.filter(ImageFilter.GaussianBlur(.6))
base = Image.alpha_composite(base, bub).convert("RGB")

# ── Finish: bloom, gentle vignette ────────────────────────────────────────
arr = np.asarray(base, float) / 255
bright = np.clip(arr - .9, 0, 1)
bloom = np.stack([gaussian_filter(bright[..., c], 16) for c in range(3)], -1)
arr = np.clip(arr + bloom * .7, 0, 1)
vig = 1 - .18 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
arr = np.clip(arr * vig[..., None], 0, 1)
out = Image.fromarray((arr * 255).astype(np.uint8))
out.save(sys.argv[1], "WEBP", quality=82, method=6)
out.save(sys.argv[2], "JPEG", quality=86)
print("saved")
