# Servidor SAM 3 (detección de paredes en servidor con GPU)

**Resultado medido** en el examen sellado de 9 casas nuevas:

| | Acierto en pared | Pinta lo que no va |
|---|---|---|
| r9 en el celular (staging) | 0,869 | 5,9 % |
| SAM 3 solo | 0,825 | 0,8 % |
| **SAM 3 + r9** (este servicio) | **0,967** | **0,3 %** |

## Requisitos del servidor
- **GPU:** NVIDIA con al menos 8 GB de VRAM (alcanza una T4; mejor una L4 o A10). SAM 3 tiene unos 900 millones de parámetros.
- **Disco:** unos 10 GB entre la imagen y el modelo.
- **Software:** Docker con `nvidia-container-toolkit`.
- **Tiempo estimado:** ~12 s por foto en una T4 (5 textos de SAM 3 a ~2,3 s cada uno, medido en Kaggle) más r9.

## Puesta en marcha
1. Copiar `interior-seg-r9.onnx` (está en el VPS, en `/opt/pintureria-ia/data/models`) a `/ruta/modelos` del servidor.
2. Construir la imagen:
   ```
   docker build -t pintureria-sam3 .
   ```
3. Arrancar el servicio. El token de Hugging Face va como variable de entorno o archivo `.env`, nunca en el repo:
   ```
   docker run -d --gpus all -p 8000:8000 --env-file .env -v /ruta/modelos:/modelos pintureria-sam3
   ```
4. Probar que responde:
   - `curl http://SERVIDOR:8000/salud`
   - `curl -F foto=@foto.jpg http://SERVIDOR:8000/segmentar -o clases.png`
5. Poner HTTPS adelante (Nginx o Caddy). Si el dominio de la app no es `https://pintu.solucionesdev.online`, cambiar `ORIGENES` para que la app pueda llamar al servicio.

## Falta
- **Conectar la app:** que con `?servidor=1` mande la foto a `/segmentar` y use el PNG como mapa de clases en lugar del modelo del celular. SAM en el navegador sigue recortando igual.
- **Medir el tiempo real** por foto en el servidor elegido.
- **Licencia de SAM 3 (Meta):** revisar las condiciones de uso comercial y de atribución antes de producción.
