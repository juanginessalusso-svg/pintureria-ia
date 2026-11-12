"""Compara dos corridas de eval/regresion/correr.sh.

Uso: python -I eval/regresion/medir.py <corrida-vieja> <corrida-nueva>
- Fotos con etiqueta a mano (etiq/<foto>.png, gris 0 = no se pinta, 80/160 = pared/techo):
    cubre  = % de la superficie de la etiqueta que la app ofrece para pintar (más es mejor)
    mal    = % de la FOTO que la app pinta y la etiqueta dice que no (menos es mejor: lo que el cliente ve como error)
- Todas: % pintado y la hoja $REG/salidas/<nueva>-vs-<vieja>.jpg con vieja | nueva | diferencia
  (magenta = ahora se pinta y antes no, amarillo = antes se pintaba y ahora no).
"""
import os, sys, numpy as np
from PIL import Image

REG = os.environ.get("REG", r"C:\Users\Admin\Desktop\Comunicacion Digital Avanzada\regresion")
A, B = sys.argv[1], sys.argv[2]
DA, DB = os.path.join(REG, "salidas", A), os.path.join(REG, "salidas", B)

def mascara(d, n):
    p = os.path.join(d, f"mascara-{n}.png")
    return np.asarray(Image.open(p).convert("L")) if os.path.exists(p) else None

names = sorted(f[8:-4] for f in os.listdir(DB) if f.startswith("mascara-"))
# etiquetas que no marcan el techo (ver etiq/techo-sin-marcar.txt): ahí el techo que pinta la app no cuenta como "mal"
_sm = os.path.join(REG, "etiq", "techo-sin-marcar.txt")
_ex = os.path.join(REG, "etiq", "excluir.txt")  # etiquetas con un error conocido: se muestran pero no entran en el promedio
EXCLUIR = {l.split("#")[0].strip() for l in open(_ex, encoding="utf8") if l.split("#")[0].strip()} if os.path.exists(_ex) else set()
SIN_TECHO = {l.strip() for l in open(_sm, encoding="utf8") if l.strip() and not l.startswith("#")} if os.path.exists(_sm) else set()
tot = {"a": [], "b": []}; rows = []
print(f"{'foto':22} {'pintado':>15} {'cubre (etiq)':>15} {'mal (etiq)':>15}")
for n in names:
    ma, mb = mascara(DA, n), mascara(DB, n)
    if ma is None or mb is None: continue
    pa, pb = (ma == 80) | (ma == 160), (mb == 80) | (mb == 160)  # lo que se pinta (el zócalo, 240, solo si el cliente lo elige)
    linea = f"{n:22} {pa.mean()*100:6.1f} -> {pb.mean()*100:5.1f}"
    e = os.path.join(REG, "etiq", f"{n}.png")
    if os.path.exists(e):
        lab = np.asarray(Image.open(e).convert("L").resize((ma.shape[1], ma.shape[0]), Image.NEAREST)) > 0
        r = []
        for k, p in (("a", pa), ("b", pb)):
            m = ma if k == "a" else mb
            cubre, mal = (p & lab).sum() / max(1, lab.sum()), (p & ~lab & ~((m == 160) & (n in SIN_TECHO))).mean()
            if n not in EXCLUIR: tot[k].append((cubre, mal))
            r.append((cubre, mal))
        linea += f" {r[0][0]*100:6.1f} -> {r[1][0]*100:5.1f} {r[0][1]*100:6.2f} -> {r[1][1]*100:5.2f}"
        if r[1][1] - r[0][1] > 0.003 or r[0][0] - r[1][0] > 0.01: linea += "  <-- PEOR"
    if n in SIN_TECHO and os.path.exists(e): linea += "  (techo sin etiquetar)"
    if n in EXCLUIR and os.path.exists(e): linea += "  (etiqueta con error: fuera del promedio)"
    print(linea)
    # hoja
    fa = os.path.join(DA, f"pintado-{n}-1.png"); fb = os.path.join(DB, f"pintado-{n}-1.png")
    if os.path.exists(fa) and os.path.exists(fb):
        a, b = Image.open(fa).convert("RGB"), Image.open(fb).convert("RGB")
        d = np.asarray(b).copy(); d[pb & ~pa] = (255, 0, 255); d[pa & ~pb] = (255, 220, 0)
        h = 300; ims = [im.resize((max(1, int(im.width * h / im.height)), h)) for im in (a, b, Image.fromarray(d))]
        r = Image.new("RGB", (sum(i.width for i in ims) + 16, h), "white"); x = 0
        for im in ims: r.paste(im, (x, 0)); x += im.width + 8
        rows.append(r)
for k, nombre in (("a", A), ("b", B)):
    if tot[k]:
        c = np.mean([t[0] for t in tot[k]]); m = np.mean([t[1] for t in tot[k]])
        print(f"PROMEDIO {nombre:14} ({len(tot[k])} fotos con etiqueta): cubre {c*100:.1f} %  ·  pinta mal {m*100:.2f} % de la foto")
if rows:
    W = max(r.width for r in rows); cols = 3; nr = (len(rows) + cols - 1) // cols
    out = Image.new("RGB", (cols * (W + 12), nr * 308), "white")
    for k, r in enumerate(rows): out.paste(r, ((k % cols) * (W + 12), (k // cols) * 308))
    dest = os.path.join(REG, "salidas", f"{B}-vs-{A}.jpg"); out.save(dest, quality=80); print("hoja:", dest)
