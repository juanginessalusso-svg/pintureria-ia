#!/bin/bash
# Emula una CPU más lenta (también para el Web Worker / WASM, a diferencia del throttling de CDP): corre el comando
# en un cgroup (v1) con cuota de CPU = (hilos / factor) núcleos. Hace falta root y /sys/fs/cgroup/cpu escribible.
# Uso:  ./slow.sh <factor> [hilos] <comando...>     ej.: ./slow.sh 4 node bench.cjs --foto t6      (≈ celular gama media)
#       ./slow.sh 4 2 node bench.cjs --foto t6 --threads 2   (2 hilos, cada "núcleo" 4 veces más lento)
# Es una APROXIMACIÓN de throughput: un celular real tiene otra memoria, caché y núcleos heterogéneos.
f=$1; shift
th=1
if [[ $1 =~ ^[0-9]+$ ]]; then th=$1; shift; fi
g=/sys/fs/cgroup/cpu/slow-$f-$th
mkdir -p "$g"
echo 10000 > "$g/cpu.cfs_period_us"
echo $((10000 * th / f)) > "$g/cpu.cfs_quota_us"
echo $$ > "$g/cgroup.procs"
FACTOR=$f exec "$@"
