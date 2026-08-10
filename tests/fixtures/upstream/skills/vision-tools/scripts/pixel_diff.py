#!/usr/bin/env python3
"""Deterministic pixel-diff fixture."""
import sys

from PIL import Image

args = sys.argv[1:]
original = Image.open(args[0])
rebuilt = Image.open(args[1])
output = args[args.index('-o') + 1]
if rebuilt.size != original.size:
    print(f'note: rebuilt was {rebuilt.width}x{rebuilt.height}, scaled to {original.width}x{original.height}')
Image.new('RGB', original.size, '#102030').save(output)
print('overall difference: 12.34%')
print(f'heatmap: {output}')
print(f'1. 23.45% x1: 0, y1: 0, x2: {original.width // 2}, y2: {original.height // 2}')
