// Progreso honesto del análisis de la foto (puro, sin DOM: se prueba con node --test).
//
// No se sabe de antemano cuántas decodificaciones va a hacer la detección (10 a ~60 según la foto), así que:
//  - la barra nunca llega al 100 % antes de terminar (tope 95 %) y no promete un total que no existe;
//  - el tiempo que se muestra es una COTA SUPERIOR razonable ("como mucho"), calculada con el ritmo que ya se
//    midió en ESTE teléfono (lo que tardó la sesión y la última decodificación), nunca con números de otra máquina.

export const DETECT_TYPICAL = 40; // decodificaciones "típicas" para escalar la barra
export const DETECT_MAX = 60; // techo observado (foto de 56); sólo sirve para la cota de tiempo
export const EMBED_SHARE = 0.2; // parte de la barra que ocupa el análisis del encoder (en fotos pesadas es chico)
// El encoder tarda ~2,7 a 3 veces lo que tardó crear la sesión (medido en 1x, 4x y 6x): sirve para estimar la 1.ª etapa en este teléfono.
export const EMBED_PER_INIT = 3;

/** "unos 40 s", "1 min", "3 min": redondeado a propósito para no aparentar precisión. */
export function fmtDuration(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return 'unos segundos';
  if (s < 90) return `unos ${Math.round(s / 10) * 10} s`;
  const m = s / 60;
  return `${m < 10 ? Math.round(m * 2) / 2 : Math.round(m)} min`.replace('.', ',');
}

/** Fracción 0..0.95 de la etapa de análisis del encoder, a partir del tiempo transcurrido y del estimado. */
export function embedFraction(elapsedMs, estimateMs) {
  if (!(estimateMs > 0)) return 0;
  return Math.min(0.95, elapsedMs / estimateMs);
}

/** Fracción 0..0.95 de la búsqueda de superficies a partir de las decodificaciones hechas. */
export function detectFraction(n) {
  return Math.min(0.95, n / DETECT_TYPICAL);
}

/** Fracción total de la barra (0..0.97). `stage`: 'wait' | 'embed' | 'detect'. */
export function totalFraction({ stage, embedElapsed = 0, embedEstimate = 0, n = 0 }) {
  if (stage === 'wait') return 0;
  if (stage === 'embed') return EMBED_SHARE * embedFraction(embedElapsed, embedEstimate);
  return Math.min(0.97, EMBED_SHARE + (1 - EMBED_SHARE) * detectFraction(n));
}

/**
 * Texto de tiempo. Devuelve '' si todavía no hay base para decir algo razonable.
 *  - embed: estimado = initMs * EMBED_PER_INIT; se avisa que después viene la búsqueda de superficies.
 *  - detect: ritmo = tiempo medio por decodificación hasta ahora; cota = ritmo * (DETECT_MAX - n).
 */
export function timeHint({ stage, initMs = 0, embedElapsed = 0, detectElapsed = 0, n = 0 }) {
  if (stage === 'embed') {
    if (!initMs) return 'Puede tardar un par de minutos en equipos lentos.';
    const est = initMs * EMBED_PER_INIT;
    const left = Math.max(0, est - embedElapsed);
    return `${left > 5000 ? `Esta parte: faltan ${fmtDuration(left)}.` : 'Esta parte está casi lista.'} Después viene buscar las paredes (tarda entre 1 y 3 veces más).`;
  }
  if (stage === 'detect') {
    if (n < 3) return 'Calculando cuánto falta…';
    const per = detectElapsed / n;
    const worst = per * Math.max(0, DETECT_MAX - n);
    const typical = per * Math.max(0, DETECT_TYPICAL - n);
    if (typical < 3000) return 'Falta poco.';
    return `Falta como mucho ${fmtDuration(worst)} (depende de la foto; si termina antes, mejor).`;
  }
  return '';
}

/** Cede el hilo principal para que el navegador pinte (barra de progreso) y atienda toques. */
export function yieldToUi() {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fin, 0));
    setTimeout(fin, 60); // en pestañas ocultas rAF no corre: nunca se cuelga esperándolo
  });
}
