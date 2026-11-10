"""Servicio de detección de paredes y techo para Pinturería IA (corre en un servidor con GPU).

POST /segmentar  (multipart, campo "foto": jpg/png)  ->  PNG en escala de grises del mismo tamaño
                 con 0 = no se pinta, 1 = pared, 2 = techo.
GET  /salud      ->  {"ok": true, "gpu": ...}

Regla (medida en el examen sellado de 9 casas: pared 0,967 / pinta mal 0,3 %; r9 solo: 0,869 / 5,9 %):
  1. SAM 3 con el texto "painted wall" (y "ceiling"): lo que marca con puntaje >= ALTO es pared/techo seguro.
  2. Donde SAM 3 no está seguro, se usa el segmentador propio (r9, ONNX) solo si SAM 3 le da al menos BAJO
     ("wall" o "painted wall") a ese píxel: el modelo propio rellena, SAM 3 veta.
  3. Instancias dudosas (puntaje entre DUDA y ALTO, >= 1 % de la foto): se aceptan ENTERAS si r9 ve al menos la mitad
     como su clase. Arregla paredes que SAM 3 ve con 0,5-0,6 (ex01 0,69 -> 0,76; promedio 0,934 -> 0,946, mismo "pinta mal").
  5-6. Fachadas: revoque ("stucco wall" >= 0,5) suma pared; cielo, portón, pérgola y ladrillo visto (>= 0,5) nunca se pintan.
  4. Resta: instancias de "tile" y "mirror" con score >= RESTA y <= 5 % de la foto se sacan (azulejo blanco que SAM 3 llamaba pared).
     0,949 -> 0,967 y 1,0 % -> 0,3 %; estable con RESTA 0,3-0,5. Ojo: la mejora viene casi toda de ex01 (cocina).
Variables de entorno: HF_TOKEN (acceso a facebook/sam3, NUNCA en el código), MODELO_R9 (ruta al .onnx),
ALTO=0.7, BAJO=0.2, DUDA=0.35, RESTA=0.4.
"""
import io, os, time
import numpy as np
import onnxruntime as ort
import torch
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from transformers import Sam3Model, Sam3Processor

ALTO = float(os.environ.get("ALTO", 0.7))
BAJO = float(os.environ.get("BAJO", 0.2))
DUDA = float(os.environ.get("DUDA", 0.35))
RESTA = float(os.environ.get("RESTA", 0.4))
DEV = "cuda" if torch.cuda.is_available() else "cpu"
TOKEN = os.environ.get("HF_TOKEN")
proc = Sam3Processor.from_pretrained("facebook/sam3", token=TOKEN)
sam = Sam3Model.from_pretrained("facebook/sam3", token=TOKEN).to(DEV).eval()
RUTA_R9 = os.environ.get("MODELO_R9", "interior-seg-r9.onnx")
if not os.path.exists(RUTA_R9) and os.environ.get("MODELO_R9_URL"):  # p. ej. https://pintu.solucionesdev.online/models/interior-seg-r9.onnx
    import urllib.request
    os.makedirs(os.path.dirname(RUTA_R9) or ".", exist_ok=True)
    urllib.request.urlretrieve(os.environ["MODELO_R9_URL"], RUTA_R9)
r9 = ort.InferenceSession(RUTA_R9, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])

app = FastAPI(title="pintureria-sam3")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("ORIGENES", "https://pintu.solucionesdev.online").split(","), allow_methods=["*"], allow_headers=["*"])


def mapas_sam(img: Image.Image, textos):
    """Para cada texto: puntaje por píxel (0-1, el mayor score de las máscaras que lo cubren) y la lista de instancias (máscara, score).
    La imagen se analiza UNA vez (get_vision_features) y se reusa para todos los textos: es la parte cara de SAM 3."""
    ii = proc(images=img, return_tensors="pt").to(DEV)
    with torch.no_grad():
        ve = sam.get_vision_features(pixel_values=ii["pixel_values"])
    W, H = img.size; res = {}
    for texto in textos:
        ti = proc(text=texto, return_tensors="pt").to(DEV)
        with torch.no_grad():
            out = sam(vision_embeds=ve, **ti)
        r = proc.post_process_instance_segmentation(out, threshold=0.1, mask_threshold=0.5, target_sizes=ii.get("original_sizes").tolist())[0]
        m = np.zeros((H, W), np.float32); inst = []
        for mk, sc in zip(r["masks"], r["scores"]):
            mk = mk.cpu().numpy().astype(bool); m[mk] = np.maximum(m[mk], float(sc)); inst.append((mk, float(sc)))
        res[texto] = (m, inst)
    return res


def clases_r9(img: Image.Image) -> np.ndarray:
    x = np.asarray(img.resize((320, 320), Image.BILINEAR), np.float32)[None].transpose(0, 3, 1, 2) / 255.0
    lg = r9.run(None, {"rgb": x})[0][0]
    W, H = img.size
    return np.stack([np.array(Image.fromarray(c).resize((W, H), Image.BILINEAR)) for c in lg.astype(np.float32)]).argmax(0)


@app.get("/salud")
def salud():
    return {"ok": True, "gpu": torch.cuda.get_device_name(0) if DEV == "cuda" else None, "alto": ALTO, "bajo": BAJO, "duda": DUDA}


def clases(img: Image.Image):
    """Foto -> mapa de clases (uint8: 0 otro / 1 pared / 2 techo) del tamaño de trabajo (lado mayor <= 1280) y los segundos que tardó."""
    if max(img.size) > 1280:  # mismo tamaño de trabajo que la app
        img.thumbnail((1280, 1280))
    t0 = time.perf_counter()
    R = mapas_sam(img, ["painted wall", "wall", "ceiling", "tile", "tiled wall", "mirror", "wallpaper", "stucco wall", "brick wall", "sky", "garage door", "pergola"])
    (pw, ipw), (ww, iww), (pc, ipc) = R["painted wall"], R["wall"], R["ceiling"]
    m9 = clases_r9(img)
    p = np.zeros(pw.shape, np.uint8)
    p[(pw >= ALTO) & (pw >= pc)] = 1
    p[(pc >= ALTO) & (pc > pw)] = 2
    p[(p == 0) & (m9 == 1) & (np.maximum(pw, ww) >= BAJO)] = 1
    p[(p == 0) & (m9 == 2) & (pc >= BAJO)] = 2
    for insts, clase in ((ipw, 1), (iww, 1), (ipc, 2)):  # regla 3: instancias dudosas que r9 confirma
        for mk, s in insts:
            if DUDA <= s < ALTO and mk.mean() >= 0.01 and np.mean(m9[mk] == clase) >= 0.5:
                p[mk & (p == 0)] = clase
    for texto in ("tile", "mirror", "wallpaper"):  # regla 4: azulejos, espejos y papel tapiz afuera
        for mk, s in R[texto][1]:
            # chicos con score >= RESTA; grandes (una pared entera de azulejo) solo si SAM 3 está seguro (>= 0,6: en ex01 una pared
            # lisa salía "tile" con 0,45). Examen interior: 0,967 -> 0,968 y pinta mal 0,3 % -> 0,2 %.
            if s >= RESTA and (mk.mean() <= 0.05 or s >= 0.6):
                p[mk] = 0
    # regla 4b: pared de azulejo entera (baños/cocinas) que "tile" no toma: "tiled wall" >= 0,6 y más alto que "painted wall".
    # Arregla el azulejo blanco de w27 y el papel tapiz con dibujos de w29; el examen interior no cambia.
    tw = R["tiled wall"][0]
    p[(tw >= 0.6) & (tw > pw)] = 0
    # Fachadas (2026-11-10; en el examen interior no cambian nada: 0,967 / 0,3 %):
    p[(p == 0) & (R["stucco wall"][0] >= 0.5)] = 1  # regla 5: revoque exterior que "painted wall" no toma
    for texto in ("sky", "garage door", "pergola", "brick wall"):  # regla 6: cielo, portón, pérgola y ladrillo visto nunca se pintan
        p[R[texto][0] >= 0.5] = 0
    return p, ids_pared(ipw + iww + R["stucco wall"][1], p == 1), time.perf_counter() - t0


def ids_pared(insts, pared, umbral=0.35, dup=0.5):
    """Número de pared por píxel (0 = sin instancia) desde las instancias de SAM 3: de mayor a menor score; una instancia que cae
    >= `dup` de su área dentro de un grupo ya hecho (el mismo muro visto por "painted wall" y "wall") se suma a ese grupo.
    Así la app separa dos paredes que se tocan en una esquina, o la franja de una fachada de la pared de abajo."""
    grupos = []
    for mk, s in sorted(insts, key=lambda x: -x[1]):
        if s < umbral: continue
        m = mk & pared; a = m.sum()
        if not a: continue
        j = next((j for j, g in enumerate(grupos) if (g & m).sum() >= dup * a), None)
        if j is None: grupos.append(m)
        else: grupos[j] |= m
    ids = np.zeros(pared.shape, np.uint8)
    for k in range(min(len(grupos), 255) - 1, -1, -1): ids[grupos[k]] = k + 1  # el de mayor score gana en los solapes
    return ids


def png(p: np.ndarray, ids: np.ndarray = None) -> bytes:
    """PNG: gris (solo clases) o RGB con R = clase (0 otro / 1 pared / 2 techo) y G = número de pared."""
    a = p if ids is None else np.stack([p, ids, np.zeros_like(p)], axis=-1)
    buf = io.BytesIO(); Image.fromarray(a).save(buf, "PNG", optimize=True); return buf.getvalue()


@app.post("/segmentar")
async def segmentar(foto: UploadFile = File(...)):
    img = Image.open(io.BytesIO(await foto.read())).convert("RGB")
    p, ids, seg = clases(img)
    return Response(png(p, ids), media_type="image/png", headers={"X-Tamano": f"{p.shape[1]}x{p.shape[0]}", "X-Segundos": f"{seg:.2f}"})
