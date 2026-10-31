import type { Day } from "./contributions";
import { HAND_FONT, paper, sketchDefs } from "./sketch";
import type { Stats } from "./stats";

export type Theme = {
  bg: string;
  grassA: string;
  grassB: string;
  line: string;
  cell: string; // color of a lit turf patch
  text: string;
  muted: string;
  accent: string;
  board: string;
  /** Hand-drawn rendering: paper grain, wobbly ink, watercolor turf. */
  sketch?: { grain: string; grainAlpha: number; washOpacity: number };
};

export const THEMES = {
  sketch: {
    bg: "#f7f1e3", grassA: "#b9d8a3", grassB: "#a6cd8e", line: "#2b2622",
    cell: "#2f6b34", text: "#2b2622", muted: "#6e655a", accent: "#c8443c", board: "#fbf6ea",
    sketch: { grain: "#5b4a36", grainAlpha: 0.55, washOpacity: 0.8 },
  },
  chalkboard: {
    bg: "#2c3a34", grassA: "#3a4d44", grassB: "#34463d", line: "#f1eee4",
    cell: "#e2f7b0", text: "#f4f1e8", muted: "#b9c4ba", accent: "#ff9b8a", board: "#26332d",
    sketch: { grain: "#ffffff", grainAlpha: 0.35, washOpacity: 1 },
  },
  classic: {
    bg: "#0b2a17", grassA: "#1f7a3a", grassB: "#1a6d33", line: "#e9f7ec",
    cell: "#d9ff6b", text: "#ffffff", muted: "#a7d6b3", accent: "#ffd84a", board: "#081c10",
  },
  floodlight: {
    bg: "#060b1a", grassA: "#0f3a2b", grassB: "#0c3324", line: "#9fe8ff",
    cell: "#4df3ff", text: "#eaf6ff", muted: "#7f9bb8", accent: "#ff4fd8", board: "#03060f",
  },
  retro: {
    bg: "#2b1a0e", grassA: "#7a8b2c", grassB: "#6e7e27", line: "#fff4d6",
    cell: "#ffb03b", text: "#fff4d6", muted: "#e1c79a", accent: "#ff5a36", board: "#1c1008",
  },
  chalk: {
    bg: "#f6f3ea", grassA: "#e4efd8", grassB: "#dae8cc", line: "#3b5a3e",
    cell: "#1f7a3a", text: "#18301c", muted: "#5d7a60", accent: "#d6336c", board: "#ffffff",
  },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;
export const DEFAULT_THEME: ThemeName = "sketch";

export function isThemeName(v: string | null | undefined): v is ThemeName {
  return !!v && v in THEMES;
}

const W = 960;
const H = 420;
const PX = 48; // pitch left
const PY = 78; // pitch top
const PW = W - PX * 2;
const PH = 272;
const LOOP = 14; // seconds per highlight reel

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmt = (n: number) => n.toLocaleString("en-US");
const r1 = (n: number) => Math.round(n * 10) / 10;

function shortDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Catmull-Rom through points, emitted as cubic Béziers. */
function smoothPath(pts: [number, number][]) {
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const [p1, p2] = [pts[i], pts[i + 1]];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(p2[0])},${r1(p2[1])}`;
  }
  return d;
}

export function renderPitch(user: string, days: Day[], stats: Stats, themeName: ThemeName = DEFAULT_THEME, still = false) {
  const t: Theme = THEMES[themeName];
  const sk = t.sketch;
  const firstDow = days.length ? new Date(days[0].date + "T00:00:00Z").getUTCDay() : 0;
  const weeks = Math.max(1, Math.ceil((days.length + firstDow) / 7));
  const cw = PW / weeks;
  const ch = PH / 7;
  const max = Math.max(1, ...days.map((d) => d.count));
  const side = Math.min(cw, ch) * 0.78;

  // Turf patches: one per day, brighter with more contributions.
  const busiest: { row: number; count: number }[] = Array.from({ length: weeks }, () => ({ row: 3, count: 0 }));
  let cells = "";
  days.forEach((d, i) => {
    const slot = i + firstDow;
    const w = Math.floor(slot / 7);
    const row = slot % 7;
    if (d.count > busiest[w].count) busiest[w] = { row, count: d.count };
    if (d.count === 0) return;
    const k = Math.sqrt(d.count / max);
    const x = PX + w * cw + (cw - side) / 2;
    const y = PY + row * ch + (ch - side) / 2;
    cells += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(side)}" height="${r1(side)}" rx="3" fill="${t.cell}" opacity="${r1(0.18 + k * 0.72)}"${sk ? ` stroke="${t.line}" stroke-width="0.6"` : ""}><title>${d.count} on ${d.date}</title></rect>`;
  });

  // The ball dribbles through each week's busiest day, then into the far goal.
  const pts: [number, number][] = [[PX + 6, PY + PH / 2]];
  busiest.forEach((b, w) => {
    const y = b.count ? PY + b.row * ch + ch / 2 : PY + PH / 2;
    pts.push([PX + w * cw + cw / 2, y]);
  });
  pts.push([PX + PW + 18, PY + PH / 2]);
  const ballPath = smoothPath(pts);

  // Mown stripes + markings.
  const stripes = Array.from({ length: 12 }, (_, i) =>
    `<rect x="${r1(PX + (PW / 12) * i)}" y="${PY}" width="${r1(PW / 12 + 0.5)}" height="${PH}" fill="${i % 2 ? t.grassB : t.grassA}"${sk ? ` opacity="${sk.washOpacity}"` : ""}/>`,
  ).join("");
  const boxH = PH * 0.6;
  const sixH = PH * 0.3;
  const goalH = PH * 0.24;
  const markings = `
    <g fill="none" stroke="${t.line}" stroke-width="${sk ? 1.6 : 2}" opacity="${sk ? 0.85 : 0.55}" stroke-linecap="round">
      <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}"/>
      <line x1="${W / 2}" y1="${PY}" x2="${W / 2}" y2="${PY + PH}"/>
      <circle cx="${W / 2}" cy="${PY + PH / 2}" r="${PH * 0.17}"/>
      <rect x="${PX}" y="${PY + (PH - boxH) / 2}" width="${PW * 0.14}" height="${boxH}"/>
      <rect x="${PX + PW * 0.86}" y="${PY + (PH - boxH) / 2}" width="${PW * 0.14}" height="${boxH}"/>
      <rect x="${PX}" y="${PY + (PH - sixH) / 2}" width="${PW * 0.05}" height="${sixH}"/>
      <rect x="${PX + PW * 0.95}" y="${PY + (PH - sixH) / 2}" width="${PW * 0.05}" height="${sixH}"/>
    </g>
    <circle cx="${W / 2}" cy="${PY + PH / 2}" r="3" fill="${t.line}" opacity="0.7"/>
    <g fill="none" stroke="${t.line}" stroke-width="2.5" opacity="0.85">
      <path d="M${PX},${PY + (PH - goalH) / 2} h-16 v${goalH} h16"/>
      <path class="net" d="M${PX + PW},${PY + (PH - goalH) / 2} h16 v${goalH} h-16"/>
    </g>`;

  const lose = busiest.filter((b) => b.count === 0).length;
  const scoreY = 44;

  // Crowd camera flashes in the stands.
  let flashes = "";
  for (let i = 0; i < 26; i++) {
    const x = PX + ((i * 137.5) % PW);
    const y = i % 2 ? PY - 10 : PY + PH + 12;
    flashes += `<circle class="flash" cx="${r1(x)}" cy="${y}" r="1.6" fill="${t.text}" style="animation-delay:${r1((i * 0.73) % LOOP)}s"/>`;
  }

  const anim = still
    ? ""
    : `
    <g>
      <animateMotion dur="${LOOP}s" repeatCount="indefinite" path="${ballPath}" keyPoints="0;1;1" keyTimes="0;0.86;1" calcMode="linear"/>
      <animate attributeName="opacity" dur="${LOOP}s" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;0.86;0.9;1"/>
      <circle r="9" fill="#000" opacity="0.25" cx="2" cy="3"/>
      <g>
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.9s" repeatCount="indefinite"/>
        <circle r="8" fill="#fff" stroke="#111" stroke-width="1.2"/>
        <polygon points="0,-3.4 3.2,-1 2,2.8 -2,2.8 -3.2,-1" fill="#111"/>
        <path d="M0,-3.4V-8M3.2,-1L7.6,-2.5M2,2.8L4.7,6.5M-2,2.8L-4.7,6.5M-3.2,-1L-7.6,-2.5" stroke="#111" stroke-width="1"/>
      </g>
    </g>
    <g class="goal" opacity="0">
      <animate attributeName="opacity" dur="${LOOP}s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;0.86;0.88;0.97;1"/>
      <text x="${W / 2}" y="${PY + PH / 2 + 22}" text-anchor="middle" font-size="64" font-weight="900" fill="${t.accent}" letter-spacing="4" stroke="${t.board}" stroke-width="3" paint-order="stroke">GOAL!</text>
    </g>`;

  const s = stats;
  const statLine = [
    `Longest streak ${s.longestStreak.length}d`,
    `Current ${s.currentStreak}d`,
    `Best matchday ${shortDate(s.bestDay.date)} (${s.bestDay.count})`,
    `Plays most on ${s.busiestWeekday}s`,
  ].join("   ·   ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(user)}'s GitHub contributions drawn as a soccer pitch: ${s.total} contributions, archetype ${esc(s.archetype.name)}">
  <title>${esc(user)} · Commit Pitch</title>
  ${sk ? `<defs>${sketchDefs({ ink: t.line, grain: sk.grain, grainAlpha: sk.grainAlpha, still })}<clipPath id="card"><rect width="${W}" height="${H}" rx="16"/></clipPath></defs>` : ""}
  <style>
    text{font-family:${sk ? HAND_FONT : `ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`}}
    .mono{font-family:${sk ? HAND_FONT : "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"}}
    .flash{opacity:0;animation:flash ${LOOP}s infinite}
    @keyframes flash{0%,96%,100%{opacity:0}97%{opacity:1}}
    .net{animation:net ${LOOP}s infinite;transform-box:fill-box;transform-origin:left center}
    @keyframes net{0%,86%,100%{transform:scaleX(1)}88%{transform:scaleX(1.6)}90%{transform:scaleX(.9)}92%{transform:scaleX(1.2)}94%{transform:scaleX(1)}}
    @media (prefers-reduced-motion:reduce){.flash,.net{animation:none}}
  </style>
  ${sk ? `<g clip-path="url(#card)">${paper(W, H, t.bg)}</g>` : `<rect width="${W}" height="${H}" rx="16" fill="${t.bg}"/>`}

  <!-- scoreboard -->
  <rect x="${W / 2 - 215}" y="12" width="430" height="50" rx="10" fill="${t.board}" stroke="${sk ? t.line : t.muted}" stroke-opacity="${sk ? 0.9 : 0.3}"${sk ? ` stroke-width="1.4" filter="url(#wob)"` : ""}/>
  <text x="${W / 2 - 198}" y="${scoreY - 6}" font-size="11" fill="${t.muted}" font-weight="700" letter-spacing="1.5">@${esc(user.toUpperCase().slice(0, 18))}</text>
  <text x="${W / 2 - 198}" y="${scoreY + 9}" font-size="10" fill="${t.muted}" letter-spacing="1">COMMITS</text>
  <text x="${W / 2}" y="${scoreY + 8}" text-anchor="middle" class="mono" font-size="26" font-weight="800" fill="${t.text}">${fmt(s.total)} <tspan fill="${t.muted}">–</tspan> ${lose}</text>
  <text x="${W / 2 + 198}" y="${scoreY - 6}" text-anchor="end" font-size="11" fill="${t.muted}" font-weight="700" letter-spacing="1.5">BUGS FC</text>
  <text x="${W / 2 + 198}" y="${scoreY + 9}" text-anchor="end" font-size="10" fill="${t.muted}" letter-spacing="1">0-COMMIT WEEKS</text>

  <text x="${PX}" y="34" font-size="11" fill="${t.muted}" letter-spacing="2" font-weight="700">COMMIT PITCH</text>
  <text x="${PX}" y="54" font-size="17" fill="${t.text}" font-weight="800">${fmt(s.activeDays)} matchdays played</text>
  <text x="${W - PX}" y="34" text-anchor="end" font-size="11" fill="${t.muted}" letter-spacing="2" font-weight="700">PLAYER ROLE</text>
  <text x="${W - PX}" y="54" text-anchor="end" font-size="17" fill="${t.accent}" font-weight="800">${esc(s.archetype.name)}</text>

  <!-- pitch -->
  <g${sk ? ` filter="url(#wob)"` : ""}>
  ${stripes}
  ${cells}
  ${markings}
  ${flashes}
  ${anim}
  </g>

  <text x="${W / 2}" y="${H - 30}" text-anchor="middle" font-size="13" fill="${t.text}" opacity="0.9">${esc(statLine)}</text>
  <text x="${W / 2}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${t.muted}" font-style="italic">“${esc(s.archetype.tagline)}”</text>
</svg>`;
}
