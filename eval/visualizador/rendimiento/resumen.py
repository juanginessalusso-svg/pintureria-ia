#!/usr/bin/env python3
"""Resume (mediana por celda) los .jsonl que produce bench.cjs. Uso: python3 resumen.py m1.jsonl m4.jsonl ..."""
import json, statistics, sys, collections

cel = collections.defaultdict(list)
for path in sys.argv[1:]:
    for linea in open(path):
        if not linea.startswith('{'):
            continue
        r = json.loads(linea)
        cel[(r['foto'], r.get('factor', path), r['threads'] or '1')].append(r)

print('archivo/factor | foto | hilos | n | decod | total s | init s | encoder s | deteccion s | carga+otros s | ok')
for (foto, fac, th), rs in sorted(cel.items()):
    med = lambda k: statistics.median([x[k] for x in rs if x.get(k) is not None] or [float('nan')])
    print(f"{fac} | {foto} | {th} | {len(rs)} | {rs[0].get('nSeg')} | {med('totalMs')/1000:.1f} | {med('initMs')/1000:.1f} | "
          f"{med('embedMs')/1000:.1f} | {med('detectMs')/1000:.1f} | {med('cargaMs')/1000:.1f} | {all(x['ok'] for x in rs)}")
