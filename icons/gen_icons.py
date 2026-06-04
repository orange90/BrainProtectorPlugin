#!/usr/bin/env python3
"""生成脑力守护扩展图标（无需第三方库）。
设计：圆角方形 + 绿色渐变背景 + 浅色「双脑叶」+ 中央沟回。"""
import struct, zlib, math, os

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def make_icon(size):
    top = (0x63, 0x99, 0x22)      # bar-green
    bottom = (0x3B, 0x6D, 0x11)   # green
    light = (0xEA, 0xF3, 0xDE)    # green-bg
    groove = (0x3B, 0x6D, 0x11)

    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    radius = size * 0.22
    cx, cy = size / 2.0, size / 2.0

    def rounded_alpha(x, y):
        # 圆角矩形抗锯齿覆盖
        margin = size * 0.06
        x0, y0, x1, y1 = margin, margin, size - margin, size - margin
        dx = max(x0 + radius - x, 0, x - (x1 - radius))
        dy = max(y0 + radius - y, 0, y - (y1 - radius))
        dist = math.hypot(dx, dy)
        if x < x0 or x > x1 or y < y0 or y > y1:
            edge = 0
        else:
            edge = 1
        if dx > 0 and dy > 0:
            return max(0.0, min(1.0, radius - dist + 0.5)) if edge else 0.0
        return float(edge)

    # 双脑叶：两个圆 + 中央分隔
    lobe_r = size * 0.20
    lobe_off = size * 0.13
    lobe_y = cy + size * 0.02
    lobes = [(cx - lobe_off, lobe_y, lobe_r), (cx + lobe_off, lobe_y, lobe_r),
             (cx - lobe_off * 0.4, cy - size * 0.16, lobe_r * 0.85),
             (cx + lobe_off * 0.4, cy - size * 0.16, lobe_r * 0.85)]

    for y in range(size):
        for x in range(size):
            a_bg = rounded_alpha(x + 0.5, y + 0.5)
            if a_bg <= 0:
                continue
            t = y / max(1, size - 1)
            r, g, b = lerp(top, bottom, t)
            # 脑叶覆盖
            inside = False
            edge_a = 0.0
            for (lx, ly, lr) in lobes:
                d = math.hypot(x + 0.5 - lx, y + 0.5 - ly)
                aa = max(0.0, min(1.0, lr - d + 0.5))
                if aa > edge_a:
                    edge_a = aa
                if d <= lr:
                    inside = True
            if edge_a > 0:
                # 中央竖沟：靠近中线时压暗，形成脑沟
                groove_factor = 1.0
                if abs(x + 0.5 - cx) < size * 0.035:
                    groove_factor = 0.0
                lc = lerp(groove, light, groove_factor)
                r = round(r * (1 - edge_a) + lc[0] * edge_a)
                g = round(g * (1 - edge_a) + lc[1] * edge_a)
                b = round(b * (1 - edge_a) + lc[2] * edge_a)
            px[y][x] = (r, g, b, round(255 * a_bg))
    return px

def write_png(path, px):
    size = len(px)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(px[y][x])
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, 'wb') as f:
        f.write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 48, 128):
        write_png(os.path.join(here, f'icon{s}.png'), make_icon(s))
        print('wrote icon%d.png' % s)
