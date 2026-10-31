import type { Day } from "./contributions";
import { HAND_FONT, paper, sketchDefs, sketchRect, squiggle, underline } from "./sketch";
import type { Stats } from "./stats";

type SkyTheme = {
  skyTop: string;
  skyBottom: string;
  building: string;
  buildingEdge: string; // the ink color in sketch themes
  window: string;
  water: string;
  text: string;
  muted: string;
  accent: string;
  stars: boolean;
  /** Hand-drawn rendering: paper grain, wobbly ink, washes and hatching. */
  sketch?: { washes: string[]; washOpacity: number; grain: string; grainAlpha: number };
};

export const SKY_THEMES = {
  sketch: {
    skyTop: "#f7f1e3", skyBottom: "#f2e8d3", building: "#c9d6e3", buildingEdge: "#2b2622",
    window: "#f4c430", water: "#cfe0ea", text: "#2b2622", muted: "#6e655a", accent: "#c8443c", stars: false,
    sketch: { washes: ["#b7cde2", "#dcc6ae", "#c3d6bd", "#e6c3bd", "#cdcde6"], washOpacity: 0.75, grain: "#5b4a36", grainAlpha: 0.55 },
  },
  chalkboard: {
    skyTop: "#2c3a34", skyBottom: "#33433c", building: "#3e4f47", buildingEdge: "#f1eee4",
    window: "#ffe58a", water: "#28352f", text: "#f4f1e8", muted: "#b9c4ba", accent: "#ff9b8a", stars: true,
    sketch: { washes: ["#4a5d55", "#536861", "#46574f"], washOpacity: 0.9, grain: "#ffffff", grainAlpha: 0.35 },
  },
  night: {
    skyTop: "#050816", skyBottom: "#1b1f4a", building: "#0d1128", buildingEdge: "#2a3170",
    window: "#ffd66b", water: "#070b1f", text: "#f4f6ff", muted: "#8f98c9", accent: "#ff4f6d", stars: true,
  },
  dusk: {
    skyTop: "#2b1b4d", skyBottom: "#ff9a6b", building: "#24163d", buildingEdge: "#5b3b7a",
    window: "#ffe29a", water: "#1d1433", text: "#fff3ea", muted: "#e8b9c4", accent: "#ffd166", stars: false,
  },
  snow: {
    skyTop: "#cfdcec", skyBottom: "#f7f9fc", building: "#5b6b82", buildingEdge: "#8193ad",
    window: "#ffe08a", water: "#b8c7da", text: "#1d2a3d", muted: "#5b6b82", accent: "#d7263d", stars: false,
  },
} satisfies Record<string, SkyTheme>;

export type SkyThemeName = keyof typeof SKY_THEMES;
export const DEFAULT_SKY_THEME: SkyThemeName = "sketch";

export function isSkyThemeName(v: string | null | undefined): v is SkyThemeName {
  return !!v && v in SKY_THEMES;
}

const W = 960;
const H = 420;
const LX = 40; // city left edge
const LW = W - LX * 2;
const SHORE = 312; // where buildings meet the waterfront
const ROAD = 8; // waterfront road height
const POD = 136; // CN Tower main pod height

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => n.toLocaleString("en-US");
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function shortDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Deterministic pseudo-random in [0,1) so the same user always gets the same city. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type Week = { total: number; start: string; days: (Day | null)[] };

function toWeeks(days: Day[]): Week[] {
  const firstDow = days.length ? new Date(days[0].date + "T00:00:00Z").getUTCDay() : 0;
  const weeks: Week[] = [];
  days.forEach((d, i) => {
    const slot = i + firstDow;
    const w = Math.floor(slot / 7);
    weeks[w] ??= { total: 0, start: d.date, days: new Array(7).fill(null) };
    weeks[w].days[slot % 7] = d;
    weeks[w].total += d.count;
  });
  return weeks.length ? weeks : [{ total: 0, start: "", days: new Array(7).fill(null) }];
}

function cnTower(cx: number, t: SkyTheme, fill: string, sw: number) {
  const base = SHORE;
  const top = 40;
  const ink = t.buildingEdge;
  return `
  <g class="tower">
    <polygon points="${cx - 13},${base} ${cx - 3.5},${POD + 14} ${cx + 3.5},${POD + 14} ${cx + 13},${base}" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>
    <line x1="${cx}" y1="${base}" x2="${cx}" y2="${POD + 16}" stroke="${ink}" stroke-width="${sw * 0.8}"/>
    <rect x="${cx - 13}" y="${POD}" width="26" height="14" rx="7" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>
    <rect x="${cx - 11}" y="${POD + 5}" width="22" height="2.5" fill="${t.window}" opacity="0.9"/>
    <rect x="${cx - 2.5}" y="${POD - 34}" width="5" height="34" fill="${fill}" stroke="${ink}" stroke-width="${sw * 0.8}"/>
    <rect x="${cx - 5}" y="${POD - 42}" width="10" height="8" rx="3" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>
    <line x1="${cx}" y1="${POD - 42}" x2="${cx}" y2="${top}" stroke="${ink}" stroke-width="${sw * 1.4}" stroke-linecap="round"/>
    <circle class="beacon" cx="${cx}" cy="${top}" r="2.6" fill="${t.accent}"/>
  </g>`;
}

function dome(cx: number, t: SkyTheme, fill: string, sw: number) {
  const ink = t.buildingEdge;
  return `<path d="M${cx - 34},${SHORE} Q${cx - 34},${SHORE - 30} ${cx},${SHORE - 30} Q${cx + 34},${SHORE - 30} ${cx + 34},${SHORE} Z" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>
  <path d="M${cx - 22},${SHORE - 26} L${cx - 22},${SHORE} M${cx},${SHORE - 30} L${cx},${SHORE} M${cx + 22},${SHORE - 26} L${cx + 22},${SHORE}" stroke="${ink}" stroke-width="0.8" opacity="0.7"/>`;
}

function cloud(x: number, y: number, s: number, t: SkyTheme) {
  const d = `M${x},${y} q${4 * s},${-9 * s} ${12 * s},${-5 * s} q${5 * s},${-10 * s} ${15 * s},${-3 * s} q${9 * s},${-3 * s} ${10 * s},${6 * s} q${7 * s},${2 * s} ${2 * s},${6 * s} z`;
  return `<path d="${d}" fill="${t.skyTop}" stroke="${t.buildingEdge}" stroke-width="1.2" stroke-linejoin="round" opacity="0.85"/>`;
}

export function renderSkyline(user: string, days: Day[], stats: Stats, themeName: SkyThemeName = DEFAULT_SKY_THEME, still = false) {
  const t: SkyTheme = SKY_THEMES[themeName];
  const sk = t.sketch;
  const ink = t.buildingEdge;
  const rand = rng(user.toLowerCase());
  const weeks = toWeeks(days);
  const n = weeks.length;
  const bw = LW / n;
  const maxWeek = Math.max(1, ...weeks.map((w) => w.total));
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const best = weeks.reduce((bi, w, i) => (w.total > weeks[bi].total ? i : bi), 0);
  const domeAt = best + 4 < n - 2 ? best + 4 : Math.max(2, best - 4);
  const sw = sk ? 1.2 : 0.8; // ink stroke width

  // One tower per week. Taller = busier week; the 7 stacked windows are its days.
  let city = "";
  let windows = "";
  weeks.forEach((w, i) => {
    if (i === best) return;
    const width = bw * (0.62 + rand() * 0.36);
    const x = LX + i * bw + (bw - width) / 2;
    const h = 16 + 120 * Math.sqrt(w.total / maxWeek) + rand() * 26;
    const y = SHORE - h;
    const roof = rand();

    if (sk) {
      const wash = sk.washes[Math.floor(rand() * sk.washes.length)];
      city += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(h)}" fill="${wash}" opacity="${sk.washOpacity}"/>`;
      city += `<rect x="${r1(x + width * 0.62)}" y="${r1(y)}" width="${r1(width * 0.38)}" height="${r1(h)}" fill="url(#hatch)"/>`;
      city += sketchRect(x, y, width, h, ink, rand, sw);
    } else {
      city += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(h)}" fill="${t.building}" stroke="${ink}" stroke-width="${sw}"/>`;
    }
    if (roof > 0.8 && h > 70) {
      city += `<line x1="${r1(x + width / 2)}" y1="${r1(y)}" x2="${r1(x + width / 2)}" y2="${r1(y - 10)}" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round"/>`;
    } else if (roof > 0.55) {
      city += `<polyline points="${r1(x - (sk ? 1 : 0))},${r1(y)} ${r1(x + width / 2)},${r1(y - 6)} ${r1(x + width + (sk ? 1 : 0))},${r1(y)}" fill="${sk ? "none" : t.building}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }

    const ws = Math.min(width * 0.5, 4.2);
    const gap = Math.min(6, (h - 10) / 7);
    w.days.forEach((d, row) => {
      if (!d) return;
      const wy = y + 6 + row * gap;
      if (wy + ws > SHORE - 2) return;
      const lit = d.count > 0;
      if (sk && !lit) return; // unlit windows stay blank paper in the sketch
      const k = lit ? 0.35 + 0.65 * Math.sqrt(d.count / maxDay) : 0.08;
      const cls = lit && rand() < 0.12 ? ` class="fl" style="animation-delay:${r1(rand() * 9)}s"` : "";
      const stroke = sk ? ` stroke="${ink}" stroke-width="0.5"` : "";
      windows += `<rect${cls} x="${r1(x + (width - ws) / 2)}" y="${r1(wy)}" width="${r1(ws)}" height="${r1(ws * 0.8)}" fill="${lit ? t.window : ink}" opacity="${r1(sk ? Math.min(1, k + 0.15) : k)}"${stroke}><title>${d.count} on ${d.date}</title></rect>`;
    });
  });

  const towerX = LX + best * bw + bw / 2;
  const domeX = LX + domeAt * bw + bw / 2;
  const landmarkFill = sk ? sk.washes[0] : t.building;
  const skyline = `<g id="city">${city}${windows}${dome(domeX, t, landmarkFill, sw)}${cnTower(towerX, t, landmarkFill, sw)}</g>`;

  let stars = "";
  if (t.stars) {
    for (let i = 0; i < 70; i++) {
      const cls = i % 4 === 0 ? ` class="tw" style="animation-delay:${r1(rand() * 4)}s"` : "";
      const cx = r1(rand() * W);
      const cy = r1(rand() * 170);
      const op = r1(0.3 + rand() * 0.6);
      stars += sk
        ? `<path${cls} d="M${cx - 2},${cy}h4M${cx},${cy - 2}v4" stroke="${ink}" stroke-width="0.9" stroke-linecap="round" opacity="${op}"/>`
        : `<circle${cls} cx="${cx}" cy="${cy}" r="${r1(0.5 + rand() * 0.9)}" fill="#fff" opacity="${op}"/>`;
    }
  }

  let ripples = "";
  for (let i = 0; i < 26; i++) {
    const x = LX + rand() * LW;
    const y = SHORE + ROAD + 10 + rand() * 80;
    const len = 8 + rand() * 26;
    ripples += sk
      ? `<g class="rp" style="animation-delay:${r1(rand() * 5)}s">${squiggle(x, y, len + 10, ink, 0.6)}</g>`
      : `<rect class="rp" x="${r1(x)}" y="${r1(y)}" width="${r1(len)}" height="1" fill="${t.window}" opacity="0.25" style="animation-delay:${r1(rand() * 5)}s"/>`;
  }

  const sunX = W - 110;
  const sun = sk
    ? `<circle cx="${sunX}" cy="96" r="18" fill="${t.window}" opacity="0.55"/>
       <circle cx="${sunX}" cy="96" r="18" fill="none" stroke="${ink}" stroke-width="1.2"/>
       <circle cx="${sunX + 1.5}" cy="95" r="19" fill="none" stroke="${ink}" stroke-width="0.6" opacity="0.5"/>`
    : `<circle cx="${sunX}" cy="96" r="18" fill="${t.window}" opacity="${t.stars ? 0.9 : 0.35}"/>`;

  // Drifting clouds (sketch only); negative begin staggers them across the sky.
  const clouds = sk
    ? [0, 1, 2]
        .map((i) => {
          const y = 80 + i * 34 + rand() * 10;
          const dur = 70 + i * 25;
          const move = still ? "" : `<animateTransform attributeName="transform" type="translate" from="-120 0" to="${W + 60} 0" dur="${dur}s" begin="${-i * 31}s" repeatCount="indefinite"/>`;
          return `<g transform="translate(${r1(120 + i * 300)} 0)">${move}${cloud(0, y, 1 + i * 0.25, t)}</g>`;
        })
        .join("")
    : "";

  const motion = still
    ? ""
    : `
  <g>
    <animateMotion dur="38s" repeatCount="indefinite" path="M-30,70 L${W + 30},48"/>
    <rect x="-7" y="-1" width="14" height="2" rx="1" fill="${sk ? ink : t.muted}"/>
    <circle class="beacon" cx="-7" cy="0" r="1.4" fill="${t.accent}"/>
  </g>
  <g>
    <animateMotion dur="22s" repeatCount="indefinite" path="M-60,${SHORE + 1} L${W + 10},${SHORE + 1}"/>
    <rect x="0" y="-9" width="44" height="9" rx="2.5" fill="#d7263d"${sk ? ` stroke="${ink}" stroke-width="1"` : ""}/>
    <rect x="4" y="-7" width="36" height="3" fill="#fff" opacity="0.85"/>
    <line x1="22" y1="-9" x2="26" y2="-15" stroke="${sk ? ink : t.muted}" stroke-width="0.8"/>
  </g>`;

  const s = stats;
  const bestWeek = weeks[best];
  const bestLabel = `best week · ${bestWeek.start ? shortDate(bestWeek.start) : "—"} · ${fmt(bestWeek.total)}`;
  const statLine = [
    `${fmt(s.activeDays)} lit windows`,
    `Longest streak ${s.longestStreak.length}d`,
    `Best day ${s.bestDay.date ? shortDate(s.bestDay.date) : "—"} (${s.bestDay.count})`,
    `Busiest on ${s.busiestWeekday}s`,
  ].join("   ·   ");

  // Notebook-style annotation pointing at the CN Tower.
  const left = towerX > W / 2;
  const noteX = towerX + (left ? -70 : 70);
  const annotation = sk
    ? `<text x="${r1(noteX)}" y="${POD - 46}" text-anchor="${left ? "end" : "start"}" font-size="15" fill="${t.accent}">${esc(bestLabel)}</text>
       <path d="M${r1(noteX + (left ? 6 : -6))},${POD - 50} q${left ? 30 : -30},-4 ${left ? 52 : -52},${46}" fill="none" stroke="${t.accent}" stroke-width="1.4" stroke-linecap="round"/>
       <path d="M${r1(towerX + (left ? -18 : 18))},${POD - 4} l${left ? -1 : 1},-7 m${left ? 1 : -1},7 l${left ? -6 : 6},-3" fill="none" stroke="${t.accent}" stroke-width="1.4" stroke-linecap="round"/>`
    : `<text x="${r1(towerX + (left ? -20 : 20))}" y="${POD + 9}" text-anchor="${left ? "end" : "start"}" font-size="10" fill="${t.muted}">${esc(bestLabel)}</text>`;

  const titleText = `${fmt(s.total)} contributions`;
  const font = sk ? HAND_FONT : `ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`;
  const fs = sk ? 1.25 : 1; // handwriting fonts run small

  const background = sk
    ? paper(W, H, t.skyTop)
    : `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  const water = sk
    ? `<rect x="0" y="${SHORE + ROAD}" width="${W}" height="${H - SHORE - ROAD}" fill="${t.water}" opacity="0.7"/>`
    : `<rect x="0" y="${SHORE + ROAD}" width="${W}" height="${H - SHORE - ROAD}" fill="${t.water}"/>`;
  const road = sk
    ? `<path d="M0,${SHORE}H${W}M0,${SHORE + ROAD}H${W}" stroke="${ink}" stroke-width="1.3"/>`
    : `<rect x="0" y="${SHORE}" width="${W}" height="${ROAD}" fill="${t.building}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(user)}'s GitHub contributions drawn as the Toronto skyline: ${s.total} contributions">
  <title>${esc(user)} · Commit Skyline</title>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.skyTop}"/><stop offset="1" stop-color="${t.skyBottom}"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${sk ? 0.3 : 0.45}"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="reflect"><rect x="0" y="${SHORE + ROAD}" width="${W}" height="${H}" fill="url(#fade)"/></mask>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="16"/></clipPath>
    ${sk ? sketchDefs({ ink, grain: sk.grain, grainAlpha: sk.grainAlpha, still }) : ""}
  </defs>
  <style>
    text{font-family:${font}}
    .fl{animation:fl 9s infinite}
    @keyframes fl{0%,100%{opacity:.9}45%{opacity:.9}50%{opacity:.1}70%{opacity:.1}75%{opacity:.9}}
    .tw{animation:tw 4s infinite ease-in-out}
    @keyframes tw{0%,100%{opacity:.9}50%{opacity:.15}}
    .beacon{animation:bk 1.6s infinite}
    @keyframes bk{0%,60%,100%{opacity:1}70%,90%{opacity:.1}}
    .rp{animation:rp 5s infinite ease-in-out}
    @keyframes rp{0%,100%{opacity:${sk ? 0.35 : 0.05}}50%{opacity:${sk ? 0.9 : 0.35}}}
    @media (prefers-reduced-motion:reduce){.fl,.tw,.beacon,.rp{animation:none}}
  </style>
  <g clip-path="url(#card)">
    ${background}
    <g${sk ? ` filter="url(#wob)"` : ""}>
      ${stars}
      ${sun}
      ${clouds}
      ${skyline}
      ${road}
      ${water}
      <g mask="url(#reflect)"><use href="#city" xlink:href="#city" transform="translate(0 ${2 * (SHORE + ROAD)}) scale(1 -1)"/></g>
      ${ripples}
      ${motion}
    </g>

    <text x="${LX}" y="38" font-size="${11 * fs}" fill="${t.muted}" letter-spacing="${sk ? 0.5 : 2}" font-weight="700">@${esc((sk ? user : user.toUpperCase()).slice(0, 24))} · ${sk ? "commit skyline" : "COMMIT SKYLINE"}</text>
    <text x="${LX}" y="${sk ? 66 : 62}" font-size="${22 * fs}" fill="${t.text}" font-weight="800">${titleText}</text>
    ${sk ? underline(LX, 74, titleText.length * 12.5, t.accent) : ""}
    <text x="${W - LX}" y="38" text-anchor="end" font-size="${11 * fs}" fill="${t.muted}" letter-spacing="${sk ? 0.5 : 2}" font-weight="700">${sk ? "Toronto · 43.64°N 79.39°W" : "TORONTO · 43.64°N 79.39°W"}</text>
    <text x="${W - LX}" y="${sk ? 64 : 62}" text-anchor="end" font-size="${17 * fs}" fill="${t.accent}" font-weight="800">${esc(s.archetype.name)}</text>
    ${annotation}

    <text x="${W / 2}" y="${H - 16}" text-anchor="middle" font-size="${12.5 * (sk ? 1.15 : 1)}" fill="${t.text}" opacity="0.9">${esc(statLine)}</text>
  </g>
</svg>`;
}
