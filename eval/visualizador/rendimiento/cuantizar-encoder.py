#!/usr/bin/env python3
"""EXPERIMENTO (no se usa en producción): cuantiza a int8 (dinámico) una copia del encoder de Acly/MobileSAM y la guarda
FUERA de modelos/. Sirve para medir cuánto ganaría el WASM con int8 y cuánto se parece el resultado al fp32.
Uso: python3 cuantizar-encoder.py modelos/mobile_sam_image_encoder.onnx /ruta/salida-int8.onnx [carpeta-con-onnx]
"""
import sys
if len(sys.argv) > 3:
    sys.path.insert(0, sys.argv[3])  # carpeta con el paquete onnx si no está instalado
from onnxruntime.quantization import quantize_dynamic, QuantType

src, dst = sys.argv[1], sys.argv[2]
quantize_dynamic(src, dst, weight_type=QuantType.QInt8, per_channel=False, reduce_range=False)
print('listo', dst)
