"""Calidad de CONTORNOS (pedido de Ginés 2026-11-13: "respetar bien los contornos de todos los objetos").

"pinta mal" de medir.py es % de la foto: un marco de puerta pintado de 6 px casi no lo mueve. Acá se mide por largo de borde:
  se pasa = píxeles pintados fuera de la etiqueta / largo del borde de la etiqueta  -> cuántos px se mete la pintura, en promedio
  le falta = píxeles de la etiqueta sin pintar / largo del borde                    -> cuántos px deja sin pintar junto al borde
  borde ok = % del borde de la etiqueta donde la pintura cae a <= 2 px del lugar justo
Solo cerca del borde (<= 25 px): lo lejano (una pared entera de más o de menos) ya lo cuenta medir.py.

Uso: python -I eval/regresion/bordes.py <corrida> [<corrida2>]   (deja salidas/<corrida>-bordes/ con recortes de lo peor)
"""
import os, sys, numpy as np
from PIL import Image, ImageFilter

REG = os.environ.get("REG", r"C:\Users\Admin\Desktop\Comunicacion Digital Avanzada\regresion")
leer = lambda f: {l.split("#")[0].strip() for l in open(f, encoding="utf8") if l.split("#")[0].strip()} if os.path.exists(f) else set()
EXCLUIR = leer(os.path.join(REG, "etiq", "excluir.txt"))
SIN_TECHO = leer(os.path.join(REG, "etiq", "techo-sin-marcar.txt"))


def dist(mask, maxd=25):
    """Distancia (en px, chebyshev) a la máscara, recortada en maxd. Con MaxFilter de PIL (sin scipy)."""
    d = np.full(mask.shape, maxd + 1, np.int16); cur = Image.fromarray(mask.astype(np.uint8) * 255)
    d[mask] = 0
    for k in range(1, maxd + 1):
        cur = cur.filter(ImageFilter.MaxFilter(3)); a = np.asarray(cur) > 0
        d[a & (d > k)] = k
    return d


def medir(corrida, guardar=True):
    D = os.path.join(REG, "salidas", corrida); out = os.path.join(REG, "salidas", corrida + "-bordes"); res = {}
    if guardar: os.makedirs(out, exist_ok=True)
    for f in sorted(os.listdir(os.path.join(REG, "etiq"))):
        if not f.endswith(".png"): continue
        n = f[:-4]; mp = os.path.join(D, f"mascara-{n}.png")
        if not os.path.exists(mp) or n in EXCLUIR: continue
        m = np.asarray(Image.open(mp).convert("L"))
        lab = np.asarray(Image.open(os.path.join(REG, "etiq", f)).convert("L").resize((m.shape[1], m.shape[0]), Image.NEAREST)) > 0
        p = (m == 80) | (m == 160)
        if n in SIN_TECHO: p = p & ~(m == 160)  # el techo que la etiqueta no marca no cuenta
        borde = lab & ~(np.asarray(Image.fromarray(lab.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(3))) > 0)
        largo = max(1, borde.sum())
        din, dout = dist(lab), dist(~lab)  # distancia a la etiqueta (afuera) y a lo que no se pinta (adentro)
        sobra = p & ~lab & (din <= 25); falta = lab & ~p & (dout <= 25)
        # borde ok: en cada punto del borde, ¿hay error a <= 2 px... no: hay error a > 2 px de distancia del borde en su vecindad?
        malo = (sobra & (din > 2)) | (falta & (dout > 2))
        cerca_malo = dist(malo, 3) <= 3
        ok = (borde & ~cerca_malo).sum() / largo
        res[n] = dict(se_pasa=sobra.sum() / largo, le_falta=falta.sum() / largo, ok=ok)
        if guardar:  # recorte del peor lugar (más píxeles de más en una ventana)
            foto = os.path.join(D, f"pintado-{n}-1.png")
            if os.path.exists(foto) and sobra.any():
                H, W = m.shape; s = 160
                c = np.cumsum(np.cumsum(sobra.astype(np.int32), 0), 1); best = (0, 0, 0)
                for y in range(0, H - s, 40):
                    for x in range(0, W - s, 40):
                        v = c[y + s, x + s] - c[y, x + s] - c[y + s, x] + c[y, x]
                        if v > best[0]: best = (v, y, x)
                _, y, x = best; im = np.asarray(Image.open(foto).convert("RGB").resize((W, H))).copy()
                ed = np.asarray(Image.fromarray(borde.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
                im[ed] = (255, 230, 0)  # amarillo = borde según la etiqueta
                Image.fromarray(im[y:y + s, x:x + s]).resize((s * 3, s * 3), Image.NEAREST).save(os.path.join(out, f"{n}.png"))
    return res


if __name__ == "__main__":
    rs = [(c, medir(c)) for c in sys.argv[1:]]
    print(f"{'foto':18}" + "".join(f" | {c[:22]:>22}" for c, _ in rs)); print(f"{'':18}" + " | se pasa  falta  ok %" * len(rs))
    for n in sorted(rs[0][1]):
        print(f"{n:18}" + "".join(f" | {r[n]['se_pasa']:6.1f} {r[n]['le_falta']:6.1f} {r[n]['ok']*100:5.0f}" if n in r else " |" for _, r in rs))
    for c, r in rs:
        v = list(r.values())
        print(f"PROMEDIO {c}: se pasa {np.mean([x['se_pasa'] for x in v]):.2f} px · le falta {np.mean([x['le_falta'] for x in v]):.2f} px · borde ok {np.mean([x['ok'] for x in v])*100:.0f} %")
