#!/usr/bin/env python3
# Generate extension icons (pure Python, no dependencies).
# Usage: python3 create_icons.py <output-dir>
import zlib, struct, sys

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def in_poly(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def in_rrect(x, y, m, r):
    lo, hi = m, 1 - m
    if not (lo <= x <= hi and lo <= y <= hi): return False
    cx = min(max(x, lo + r), hi - r); cy = min(max(y, lo + r), hi - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def lerp(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

TOP, BOT = (0x2F, 0x80, 0xED), (0x5B, 0x3F, 0xD9)       # blue -> indigo
WING = [(0.20, 0.50), (0.80, 0.22), (0.47, 0.57)]          # main wing
FOLD = [(0.47, 0.57), (0.80, 0.22), (0.58, 0.80)]          # folded wing (slightly shaded)
BADGE = (0.76, 0.76, 0.17)                                 # connected dot (cx, cy, r)

def render(size, connected=False, ss=4):
    margin = 0.04 if size > 16 else 0.0
    radius = 0.22
    px = []
    n = ss * ss
    for py in range(size):
        for pxl in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (pxl + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    col, a = None, 0.0
                    if in_rrect(x, y, margin, radius):
                        col, a = lerp(TOP, BOT, y), 1.0
                        if in_poly(x, y, WING): col = (255, 255, 255)
                        elif in_poly(x, y, FOLD): col = (0xD6, 0xE2, 0xFF)
                    if connected:
                        bx, by, br = BADGE
                        d2 = (x - bx) ** 2 + (y - by) ** 2
                        if d2 <= br * br:
                            col, a = ((0x34, 0xC7, 0x59) if d2 <= (br * 0.78) ** 2 else (255, 255, 255)), 1.0
                    if col:
                        for i in range(3): acc[i] += col[i] * a
                        acc[3] += a
            if acc[3]:
                px += [round(acc[i] / acc[3]) for i in range(3)] + [round(255 * acc[3] / n)]
            else:
                px += [0, 0, 0, 0]
    return px

out = sys.argv[1]
for s in (16, 48, 128):
    png(f'{out}/icon{s}.png', s, s, render(s))
png(f'{out}/icon-connected-16.png', 16, 16, render(16, True))
