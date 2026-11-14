"""Worker de RunPod Serverless: recibe la foto en base64 y devuelve el mapa de clases en PNG base64.
Entrada:  {"input": {"imagen": "<jpeg/png en base64>"}}
Salida:   {"png": "<base64>", "ancho": W, "alto": H, "segundos": s}   (o {"error": "..."})
Los modelos se cargan UNA vez al arrancar el worker (import de app); cada pedido solo corre la inferencia."""
import base64, io
import runpod
from PIL import Image, ImageOps
from app import clases, png, mapas_sam, afinar, ade, render
import numpy as np


def handler(job):
    if job["input"].get("ping"):  # "despertador": la app lo manda al abrir la página; los modelos ya se cargaron al arrancar el worker
        return {"pong": True}
    try:
        datos = base64.b64decode(job["input"]["imagen"])
        if len(datos) > 8 * 1024 * 1024:
            return {"error": "foto_muy_grande"}
        crudo = ImageOps.exif_transpose(Image.open(io.BytesIO(datos)))
        img = crudo.convert("RGB")
    except Exception as e:  # noqa: BLE001 - foto ilegible
        return {"error": f"foto_invalida: {e}"}
    textos = job["input"].get("textos")
    if textos and textos[0] == "__render__":  # diagnóstico (2026-11-14): PNG RGBA = foto ya recoloreada + máscara en alfa -> render generativo
        if crudo.mode != "RGBA":
            return {"error": "render_pide_png_con_alfa"}
        try:
            fuerza = float(textos[1]) if len(textos) > 1 else 0.35
            r, t = render(crudo, fuerza=max(0.05, min(0.9, fuerza)))
        except Exception:  # noqa: BLE001 - prueba: que el error llegue al diagnóstico
            import traceback
            return {"mapas": {"error": traceback.format_exc()[-1500:]}, "ancho": 0, "alto": 0}
        buf = io.BytesIO(); r.save(buf, "JPEG", quality=92)
        return {"mapas": {"render": base64.b64encode(buf.getvalue()).decode()}, "ancho": r.size[0], "alto": r.size[1], "segundos_render": round(t, 2)}
    if textos == ["__ade__"]:  # diagnóstico (2026-11-14): mapa normal + clases ADE20K de OneFormer (R = clase, G = confianza)
        p, ids, veto, seg = clases(img)
        try:
            c, conf, t = ade(img)
        except Exception as e:  # noqa: BLE001 - prueba: que el error llegue al diagnóstico
            import traceback
            return {"mapas": {"error": traceback.format_exc()[-1500:]}, "ancho": 0, "alto": 0}
        return {"mapas": {"base": base64.b64encode(png(p, ids, veto)).decode(), "ade": base64.b64encode(png(c, conf, np.zeros_like(c))).decode()},
                "ancho": int(p.shape[1]), "alto": int(p.shape[0]), "segundos": round(seg, 2), "segundos_ade": round(t, 2)}
    if textos == ["__afinar__"]:  # diagnóstico (2026-11-13): mapa normal y el mismo con los bordes afinados por CascadePSP, para comparar
        p, ids, veto, seg = clases(img)
        p2, ids2, t = afinar(img, p, ids)
        return {"mapas": {"base": base64.b64encode(png(p, ids, veto)).decode(), "afinado": base64.b64encode(png(p2, ids2, veto)).decode()},
                "ancho": int(p.shape[1]), "alto": int(p.shape[0]), "segundos": round(seg, 2), "segundos_afinar": round(t, 2)}
    if textos:  # diagnóstico (solo staging): mapa de puntaje 0-255 por cada texto, para probar reglas nuevas sin rehacer la imagen
        if not isinstance(textos, list) or len(textos) > 12 or not all(isinstance(t, str) and 0 < len(t) <= 40 for t in textos):
            return {"error": "textos_invalidos"}
        if max(img.size) > 1280:
            img.thumbnail((1280, 1280))
        R = mapas_sam(img, textos)
        return {"mapas": {t: base64.b64encode(png((R[t][0] * 255).astype(np.uint8))).decode() for t in textos}, "ancho": img.size[0], "alto": img.size[1]}
    p, ids, veto, seg = clases(img)
    return {"png": base64.b64encode(png(p, ids, veto)).decode(), "ancho": int(p.shape[1]), "alto": int(p.shape[0]), "segundos": round(seg, 2)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
