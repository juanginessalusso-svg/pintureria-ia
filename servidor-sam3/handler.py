"""Worker de RunPod Serverless: recibe la foto en base64 y devuelve el mapa de clases en PNG base64.
Entrada:  {"input": {"imagen": "<jpeg/png en base64>"}}
Salida:   {"png": "<base64>", "ancho": W, "alto": H, "segundos": s}   (o {"error": "..."})
Los modelos se cargan UNA vez al arrancar el worker (import de app); cada pedido solo corre la inferencia."""
import base64, io
import runpod
from PIL import Image, ImageOps
from app import clases, png


def handler(job):
    try:
        datos = base64.b64decode(job["input"]["imagen"])
        if len(datos) > 8 * 1024 * 1024:
            return {"error": "foto_muy_grande"}
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(datos))).convert("RGB")
    except Exception as e:  # noqa: BLE001 - foto ilegible
        return {"error": f"foto_invalida: {e}"}
    p, seg = clases(img)
    return {"png": base64.b64encode(png(p)).decode(), "ancho": int(p.shape[1]), "alto": int(p.shape[0]), "segundos": round(seg, 2)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
