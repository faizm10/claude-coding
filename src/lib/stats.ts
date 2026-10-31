import type { Day } from "./contributions";

export type Archetype = { name: string; tagline: string; emoji: string };

export type Stats = {
  total: number;
  activeDays: number;
  longestStreak: { length: number; start: number; end: number }; // day indices
  currentStreak: number;
  bestDay: Day;
  busiestWeekday: string;
  weekendShare: number;
  archetype: Archetype;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function computeStats(days: Day[]): Stats {
  let total = 0;
  let activeDays = 0;
  let best: Day = days[0] ?? { date: "", count: 0 };
  const byWeekday = new Array(7).fill(0);
  let longest = { length: 0, start: 0, end: -1 };
  let run = 0;

  days.forEach((d, i) => {
    total += d.count;
    byWeekday[new Date(d.date + "T00:00:00Z").getUTCDay()] += d.count;
    if (d.count > best.count) best = d;
    if (d.count > 0) {
      activeDays++;
      run++;
      if (run > longest.length) longest = { length: run, start: i - run + 1, end: i };
    } else {
      run = 0;
    }
  });

  // Today often has no contributions yet; don't let that break the current streak.
  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) currentStreak++;
    else if (i === days.length - 1) continue;
    else break;
  }

  const weekendShare = total ? (byWeekday[0] + byWeekday[6]) / total : 0;
  const busiestWeekday = WEEKDAYS[byWeekday.indexOf(Math.max(...byWeekday))];

  const last30 = days.slice(-30).reduce((s, d) => s + d.count, 0);
  const monthlyAvg = total / Math.max(1, days.length / 30);
  const activeRatio = days.length ? activeDays / days.length : 0;
  const activeCounts = days.filter((d) => d.count > 0).map((d) => d.count).sort((a, b) => a - b);
  const median = activeCounts[Math.floor(activeCounts.length / 2)] ?? 0;

  let archetype: Archetype;
  if (total === 0) {
    archetype = { name: "Bench Warmer", tagline: "Still waiting for the manager's call.", emoji: "🪑" };
  } else if (longest.length >= 60) {
    archetype = { name: "Iron Man", tagline: `${longest.length} matchdays without missing a minute.`, emoji: "🦾" };
  } else if (activeRatio > 0.75) {
    archetype = { name: "Box-to-Box Engine", tagline: "Covers every blade of grass, every week.", emoji: "⚡" };
  } else if (weekendShare > 0.4) {
    archetype = { name: "Sunday League Legend", tagline: "Saturdays and Sundays are match days.", emoji: "🍺" };
  } else if (last30 > monthlyAvg * 2 && last30 > 20) {
    archetype = { name: "Wonderkid", tagline: "Breakout form over the last 30 days.", emoji: "⭐" };
  } else if (best.count >= median * 8 && activeRatio < 0.4) {
    archetype = { name: "Clinical Striker", tagline: "Quiet for long spells, then hat-tricks.", emoji: "🎯" };
  } else if (weekendShare < 0.06 && activeRatio > 0.3) {
    archetype = { name: "Club Captain", tagline: "Never misses a weekday training session.", emoji: "🧢" };
  } else {
    archetype = { name: "Midfield Maestro", tagline: "Keeps the tempo and controls the game.", emoji: "🎩" };
  }

  return { total, activeDays, longestStreak: longest, currentStreak, bestDay: best, busiestWeekday, weekendShare, archetype };
}
