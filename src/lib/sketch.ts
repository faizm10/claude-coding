/** Shared pieces for the hand-drawn ("sketch") look used by every scene. */

export const HAND_FONT = `"Bradley Hand","Segoe Print","Chalkboard SE","Comic Neue","Marker Felt",cursive`;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Filters for the hand-drawn look:
 *  - #wob: displaces edges so lines wobble like pen strokes; the noise seed steps
 *    a few times a second for a "line boil", like frame-by-frame animation.
 *  - #grain: paper texture tinted with the given color.
 */
export function sketchDefs({ ink, grain, grainAlpha, still }: { ink: string; grain: string; grainAlpha: number; still: boolean }) {
  const [gr, gg, gb] = hexToRgb(grain);
  const boil = still
    ? ""
    : `<animate attributeName="seed" values="2;5;9;13" dur="0.9s" repeatCount="indefinite" calcMode="discrete"/>`;
  return `
    <filter id="wob" x="-3%" y="-3%" width="106%" height="106%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="2" result="n">${boil}</feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 ${r1(gr / 255)}  0 0 0 0 ${r1(gg / 255)}  0 0 0 0 ${r1(gb / 255)}  ${grainAlpha} 0 0 0 ${-grainAlpha * 0.35}"/>
    </filter>
    <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
      <stop offset="0.6" stop-color="${ink}" stop-opacity="0"/>
      <stop offset="1" stop-color="${ink}" stop-opacity="0.16"/>
    </radialGradient>
    <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <line x1="0" y1="0" x2="0" y2="4" stroke="${ink}" stroke-width="0.7" opacity="0.45"/>
    </pattern>`;
}

/** Paper background: base color, grain, darker edges. */
export function paper(w: number, h: number, color: string) {
  return `<rect width="${w}" height="${h}" fill="${color}"/>
    <rect width="${w}" height="${h}" filter="url(#grain)"/>
    <rect width="${w}" height="${h}" fill="url(#vignette)"/>`;
}

/** Architect-style rectangle: four strokes that overshoot the corners a little. */
export function sketchRect(x: number, y: number, w: number, h: number, ink: string, rand: () => number, width = 1.1) {
  const o = () => 1 + rand() * 3; // overshoot
  const j = () => (rand() - 0.5) * 1.2; // jitter
  const seg = (x1: number, y1: number, x2: number, y2: number) =>
    `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`;
  const d = [
    seg(x - o(), y + j(), x + w + o(), y + j()),
    seg(x + w + j(), y - o(), x + w + j(), y + h),
    seg(x + j(), y - o(), x + j(), y + h),
  ].join("");
  return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${width}" stroke-linecap="round"/>`;
}

/** A short wavy scribble, e.g. water ripples. */
export function squiggle(x: number, y: number, len: number, ink: string, opacity: number) {
  const step = 7;
  let d = `M${r1(x)},${r1(y)}`;
  for (let i = 0; i < len / step; i++) d += ` q${step / 2},${i % 2 ? 2.4 : -2.4} ${step},0`;
  return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1" stroke-linecap="round" opacity="${opacity}"/>`;
}

/** A loose hand-drawn underline. */
export function underline(x: number, y: number, len: number, ink: string) {
  return `<path d="M${r1(x)},${r1(y)} q${r1(len * 0.3)},-3 ${r1(len * 0.62)},-1 t${r1(len * 0.38)},1.5" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
