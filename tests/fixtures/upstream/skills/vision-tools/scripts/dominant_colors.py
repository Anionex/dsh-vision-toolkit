#!/usr/bin/env python3
"""Deterministic dominant-colour fixture."""
import sys

args = sys.argv[1:]
if '--candidates' in args:
    candidates = args[args.index('--candidates') + 1].split(',')
    print('region 0,0,256,256 - 256x256 px (65536 px sampled)')
    print('candidate   share   mean_d  wt    bar')
    for index, candidate in enumerate(candidates):
        mark = '*' if index == 0 else ' '
        print(f'{mark}{candidate:<9} {42.0 - index:5.1f}%  {4.0 + index:4.1f}  {100 - index * 10:4.0f}%  ####')
    print(f'winner: {candidates[0]} (* in table) - wt is soft-match closeness, so the winner need not have the highest share; 42.0% of region pixels within distance <= 16')
else:
    print('region 0,0,256,256 - 256x256 px')
    print('top 5 of 8 clusters (merged at distance <= 8):')
    print('#336699   42.1%  ####################')
    print('#FFFFFF   31.0%  ###############')
