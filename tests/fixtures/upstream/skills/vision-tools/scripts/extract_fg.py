#!/usr/bin/env python3
"""Deterministic foreground-extraction fixture."""
import sys

from PIL import Image

args = sys.argv[1:]
output = args[args.index('-o') + 1]
Image.new('RGBA', (32, 24), (51, 102, 153, 200)).save(output)
print('bbox (原图像素): x1: 10, y1: 20, x2: 42, y2: 44')
print('前景像素: 512  保留分量: 1/2  最大分量占比: 88%')
print(f'wrote {output} (32x24)')
