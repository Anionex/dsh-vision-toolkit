#!/usr/bin/env python3
"""Deterministic long-screenshot OCR fixture."""
import hashlib
import json
import os
import sys
from pathlib import Path

from PIL import Image


def main():
    args = sys.argv[1:]
    source = Path(args[0]).resolve()
    output = Path(args[args.index('-o') + 1]).resolve()
    chunks_dir = Path(args[args.index('--chunks-dir') + 1]).resolve()
    mode = args[args.index('--mode') + 1]
    split_only = '--split-only' in args
    if not split_only and not os.environ.get('VISION_API_KEY'):
        print('Missing config VISION_API_KEY', file=sys.stderr)
        sys.exit(1)
    chunks_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        chunk = image.crop((0, 0, image.width, image.height))
        chunk_path = chunks_dir / 'chunk_001.png'
        chunk.save(chunk_path)
        width, height = image.size
    digest = hashlib.sha256(chunk_path.read_bytes()).hexdigest()
    record = {
        'index': 1,
        'image': chunk_path.name,
        'image_sha256': digest,
        'core_top': 0,
        'core_bottom': height,
        'crop_top': 0,
        'crop_bottom': height,
        'top_overlap': 0,
        'bottom_overlap': 0,
        'cut_energy': None,
        'cut_quality': None,
        'top_safe_margin': None,
        'bottom_safe_margin': None,
    }
    if not split_only:
        sidecar = chunk_path.with_suffix('.ocr.json' if mode == 'chat' else '.ocr.md')
        sidecar.write_text('{"messages": []}\n' if mode == 'chat' else 'Fixture OCR text\n', encoding='utf-8')
        record.update({'ocr': sidecar.name, 'ocr_reused': '--resume' in args})
        output.write_text('Fixture merged OCR\n', encoding='utf-8')
        (chunks_dir / 'ocr_audit.md').write_text('# Fixture audit\n', encoding='utf-8')
    manifest = {
        'schema_version': 1,
        'input': str(source),
        'image_width': width,
        'image_height': height,
        'mode': mode,
        'target_height': 1600,
        'min_height': 900,
        'max_height': 2200,
        'fallback_overlap': 120,
        'analysis': {},
        'chunks': [record],
        'merge_boundaries': [],
        'output': None if split_only else str(output),
        'complete': not split_only,
    }
    manifest_path = chunks_dir / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(manifest_path if split_only else output)


if __name__ == '__main__':
    main()
