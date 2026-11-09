"""
Generates a simple series-circuit PNG for end-to-end testing of the
Gemini image-analysis pipeline. Uses ONLY the Python standard library
(zlib + struct) — no Pillow, no matplotlib.

Circuit: 12 V battery (left branch) in series with a 4 Ω resistor (top branch),
forming a single closed loop. Clear ANSI-style symbols with value labels.
"""
import os
import struct
import zlib

WIDTH = 560
HEIGHT = 360

# ---------------------------------------------------------------------------
# Minimal 5x7 bitmap font for the labels we need
# ---------------------------------------------------------------------------
FONT = {
    '0': ["01110","10001","10011","10101","11001","10001","01110"],
    '1': ["00100","01100","00100","00100","00100","00100","01110"],
    '2': ["01110","10001","00001","00010","00100","01000","11111"],
    '3': ["11110","00001","00001","01110","00001","00001","11110"],
    '4': ["00010","00110","01010","10010","11111","00010","00010"],
    'V': ["10001","10001","10001","01010","01010","00100","00100"],
    ' ': ["00000","00000","00000","00000","00000","00000","00000"],
    # Ohm approximated as a stylized "Ω" using a horseshoe shape
    'O': ["01110","10001","10001","10001","10001","10001","01110"],
}

def char_width(): return 5
def char_height(): return 7

# ---------------------------------------------------------------------------
# Pixel buffer (RGB)
# ---------------------------------------------------------------------------
BLACK = (30, 41, 59)     # #1e293b
WHITE = (255, 255, 255)
BLUE  = (2, 132, 199)    # #0284c7 for voltage label
AMBER = (217, 119, 6)    # #d97706 for resistor label

buf = [[WHITE] * WIDTH for _ in range(HEIGHT)]

def set_pixel(x, y, color):
    if 0 <= x < WIDTH and 0 <= y < HEIGHT:
        buf[y][x] = color

def draw_line(x0, y0, x1, y1, color=BLACK, thickness=2):
    """Bresenham line with simple thickness."""
    dx = abs(x1 - x0); dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    while True:
        for ox in range(-(thickness//2), thickness//2 + 1):
            for oy in range(-(thickness//2), thickness//2 + 1):
                set_pixel(x0 + ox, y0 + oy, color)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 > -dy: err -= dy; x0 += sx
        if e2 < dx:  err += dx; y0 += sy

def draw_hline(x, y, length, color=BLACK, thickness=2):
    draw_line(x, y, x + length, y, color, thickness)

def draw_vline(x, y, length, color=BLACK, thickness=2):
    draw_line(x, y, x, y + length, color, thickness)

def draw_text(text, x, y, color=BLACK, scale=2):
    """Draw text using the bitmap font, scaled by `scale`."""
    for i, ch in enumerate(text):
        glyph = FONT.get(ch, FONT.get(ch.upper(), FONT[' ']))
        gx = x + i * (char_width() + 1) * scale
        for row_idx, row in enumerate(glyph):
            for col_idx, pixel in enumerate(row):
                if pixel == '1':
                    for sx in range(scale):
                        for sy in range(scale):
                            set_pixel(gx + col_idx * scale + sx,
                                      y + row_idx * scale + sy, color)

def fill_circle(cx, cy, r, color=BLACK):
    for y in range(-r, r + 1):
        for x in range(-r, r + 1):
            if x*x + y*y <= r*r:
                set_pixel(cx + x, cy + y, color)

# ---------------------------------------------------------------------------
# Draw the circuit
# ---------------------------------------------------------------------------
# Loop rectangle: left=130, right=430, top=130, bottom=280
LX, RX, TY, BY = 130, 430, 130, 280

# --- Wires (with gaps for components) ---
# Top wire (gap in middle for resistor)
draw_hline(LX, TY, 145)              # left half of top
draw_hline(LX + 155, TY, RX - LX - 155)  # right half of top

# Bottom wire (full)
draw_hline(LX, BY, RX - LX)

# Left wire (gap in middle for battery)
draw_vline(LX, TY, 65)               # upper part
draw_vline(LX, TY + 85, BY - TY - 85)  # lower part

# Right wire (full)
draw_vline(RX, TY, BY - TY)

# --- Battery symbol (left branch, center-left) ---
by = TY + (BY - TY) // 2  # battery center y
# Positive plate (long line)
draw_hline(LX - 16, by - 8, 32, color=BLACK, thickness=3)
# Negative plate (short line)
draw_hline(LX - 8, by + 6, 16, color=BLACK, thickness=4)
# Second cell
draw_hline(LX - 16, by + 14, 32, color=BLACK, thickness=3)
draw_hline(LX - 8, by + 24, 16, color=BLACK, thickness=4)

# Polarity symbols
draw_text("+", LX - 4, by - 22, BLUE, scale=2)
draw_text("-", LX - 2, by + 32, BLUE, scale=2)

# Voltage value label
draw_text("12 V", LX - 60, by + 4, BLUE, scale=2)

# --- Resistor symbol (top branch, center-top) ---
rx = LX + (RX - LX) // 2  # resistor center x
ry = TY
# Zigzag resistor
zig_points = [
    (rx - 36, ry),
    (rx - 28, ry - 10),
    (rx - 18, ry + 10),
    (rx - 8, ry - 10),
    (rx + 2, ry + 10),
    (rx + 12, ry - 10),
    (rx + 22, ry + 10),
    (rx + 30, ry),
    (rx + 36, ry),
]
for i in range(len(zig_points) - 1):
    x0, y0 = zig_points[i]
    x1, y1 = zig_points[i + 1]
    draw_line(x0, y0, x1, y1, color=AMBER, thickness=3)

# Resistor value label
draw_text("4 O", rx - 16, ry - 26, AMBER, scale=2)

# --- Junction dots ---
for cx, cy in [(LX, TY), (RX, TY), (RX, BY), (LX, BY)]:
    fill_circle(cx, cy, 4, BLACK)

# --- Title text ---
draw_text("12 V battery in series with 4 ohm resistor", 40, 50, (15, 23, 42), scale=2)

# ---------------------------------------------------------------------------
# Encode as PNG
# ---------------------------------------------------------------------------
def make_chunk(chunk_type, data):
    length = struct.pack('>I', len(data))
    crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
    return length + chunk_type + data + crc

def encode_png():
    sig = b'\x89PNG\r\n\x1a\n'
    # IHDR: width, height, bit depth 8, color type 2 (RGB)
    ihdr = struct.pack('>IIBBBBB', WIDTH, HEIGHT, 8, 2, 0, 0, 0)
    # IDAT: filter byte 0 + RGB data per row
    raw = bytearray()
    for row in buf:
        raw.append(0)  # filter type None
        for r, g, b in row:
            raw.extend((r, g, b))
    compressed = zlib.compress(bytes(raw))
    return sig + make_chunk(b'IHDR', ihdr) + make_chunk(b'IDAT', compressed) + make_chunk(b'IEND', b'')

out_path = os.path.join(os.path.dirname(__file__), 'sample_series_circuit.png')
png_data = encode_png()
with open(out_path, 'wb') as f:
    f.write(png_data)
print(f"Wrote {out_path} ({len(png_data)} bytes)")
