# Servicio SAM 3 + r9 para GPU NVIDIA.
# Por defecto arranca el worker de RunPod Serverless (handler.py). Para correrlo como API HTTP propia:
#   docker run --gpus all -p 8000:8000 -e HF_TOKEN=... pintureria-sam3 uvicorn app:app --host 0.0.0.0 --port 8000
# Variables: HF_TOKEN (acceso a facebook/sam3; se configura en RunPod como secreto, NUNCA en este archivo),
#            MODELO_R9_URL (de donde se baja r9 si no está), HF_HOME (caché de SAM 3: en RunPod, el volumen de red).
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime
WORKDIR /app
RUN pip install --no-cache-dir "transformers==5.22.2" accelerate fastapi "uvicorn[standard]" python-multipart onnxruntime-gpu pillow runpod
# Funciona con el contexto en la raíz del repo (RunPod desde GitHub) o dentro de servidor-sam3/ (docker build local).
COPY . /src
RUN if [ -f /src/servidor-sam3/app.py ]; then cp /src/servidor-sam3/app.py /src/servidor-sam3/handler.py /app/; else cp /src/app.py /src/handler.py /app/; fi && rm -rf /src
ENV MODELO_R9=/runpod-volume/modelos/interior-seg-r9.onnx \
    MODELO_R9_URL=https://pintu.solucionesdev.online/models/interior-seg-r9.onnx \
    HF_HOME=/runpod-volume/hf \
    PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "-u", "handler.py"]
