# Licencias de terceros

Este proyecto usa los siguientes modelos y librerías. Todos permiten uso comercial; se conservan acá sus avisos.

## Modelos de segmentación (se descargan, no están en el repo)

| Componente | Origen | Licencia |
|---|---|---|
| **MobileSAM** (pesos y código) | https://github.com/ChaoningZhang/MobileSAM | Apache License 2.0 |
| Export ONNX del encoder y decoder | https://huggingface.co/Acly/MobileSAM | MIT (declarada en la ficha del repo; deriva de MobileSAM, Apache-2.0) |
| **Segment Anything** (decoder original de Meta) | https://github.com/facebookresearch/segment-anything | Apache License 2.0 |

Archivos usados: `mobile_sam_image_encoder.onnx` (28 157 093 bytes, sha256 `580f5fb6…c749`) y
`sam_mask_decoder_single.onnx` (16 501 323 bytes, sha256 `93915fc7…570d`). `apps/api/scripts/fetch-models.mjs` los baja
y verifica el hash.

Apache-2.0 exige conservar el aviso de copyright y una copia de la licencia al redistribuir
(texto completo: https://www.apache.org/licenses/LICENSE-2.0). MIT exige conservar su aviso de copyright.

Nota de procedencia: el export ONNX es una subida de un tercero (Acly), no un release oficial de MobileSAM. La licencia
de los pesos no está declarada por separado en el repo oficial (aplica la licencia del repo, Apache-2.0).

## Librerías

| Librería | Licencia |
|---|---|
| ONNX Runtime Web (`onnxruntime-web`) | MIT |
| Preact | MIT |
| Express, zod, better-sqlite3 | MIT |

## Modelos NO usados (pendientes de verificar antes de usarlos)
Cualquier otro modelo o dataset (SegFormer, ADE20K, etc.) debe verificarse para uso comercial **antes** de incorporarlo.
