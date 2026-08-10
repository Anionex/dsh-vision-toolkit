#!/usr/bin/env python3
"""Deterministic local-HTML screenshot fixture."""
import sys

from PIL import Image


def find_chrome():
    return '/fixture/chrome'


if __name__ == '__main__':
    args = sys.argv[1:]
    output = args[args.index('-o') + 1]
    width = int(args[args.index('--width') + 1])
    height = int(args[args.index('--height') + 1])
    scale = int(args[args.index('--scale') + 1])
    Image.new('RGB', (width * scale, height * scale), '#F5F5F5').save(output)
    print(f'wrote {output} ({width * scale}x{height * scale})')
