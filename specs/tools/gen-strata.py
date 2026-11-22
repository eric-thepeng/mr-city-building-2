# Makes Assets/Textures/terrain_strata.png: the rock bands of webxr/src/assets.js (addRockStrata)
# as a lookup texture. X = how cliff-like a face is (white at 0, rock at 1), Y = board height.
#   python specs/tools/gen-strata.py
import os
from PIL import Image

W, H, BANDS = 32, 512, 14  # 14 bands of 0.034 game units
A, B, LINE = (0xE8, 0xA2, 0x7E), (0xD0, 0x8A, 0x68), (0xB8, 0x74, 0x56)

img = Image.new('RGB', (W, H))
for row in range(H):
    v = (H - row - 0.5) / H  # V = 0 at the bottom of the image
    band = (v * BANDS) % 1
    rock = LINE if band >= 0.92 else (A if band < 0.55 else B)
    for x in range(W):
        k = x / (W - 1)
        img.putpixel((x, row), tuple(round(255 + (c - 255) * k) for c in rock))
out = os.path.join(os.path.dirname(__file__), '..', 'MarsHomecoming', 'Assets', 'Textures', 'terrain_strata.png')
img.save(out, optimize=True)
print('wrote', os.path.normpath(out))
