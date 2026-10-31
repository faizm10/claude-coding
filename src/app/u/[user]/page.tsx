import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DEFAULT_THEME, THEMES, isThemeName } from "@/lib/pitch";
import { SITE_URL as SITE } from "@/lib/site";
import { DEFAULT_SKY_THEME, SKY_THEMES, isSkyThemeName } from "@/lib/skyline";
import { getPlayer } from "@/lib/player";
import { KickoffForm } from "../../KickoffForm";
import { CopyButton } from "./CopyButton";

async function load(user: string) {
  const stats = await getPlayer(user);
  if (!stats) notFound();
  return stats;
}

export async function generateMetadata({ params }: PageProps<"/u/[user]">): Promise<Metadata> {
  const { user } = await params;
  const stats = await load(user);
  const title = `@${user} is a ${stats.archetype.name} · Commit City`;
  const description = `${stats.total.toLocaleString("en-US")} contributions, ${stats.longestStreak.length}-day best streak. What's yours?`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default function UserPage(props: PageProps<"/u/[user]">) {
  return (
    <Suspense fallback={<main><div className="kicker">Warming up…</div></main>}>
      <Player {...props} />
    </Suspense>
  );
}

async function Player({ params, searchParams }: PageProps<"/u/[user]">) {
  const { user } = await params;
  const sp = await searchParams;
  const scene = sp.scene === "pitch" ? "pitch" : "skyline";
  const themeParam = typeof sp.theme === "string" ? sp.theme : undefined;
  const themes = Object.keys(scene === "pitch" ? THEMES : SKY_THEMES);
  const fallback = scene === "pitch" ? DEFAULT_THEME : DEFAULT_SKY_THEME;
  const theme = (scene === "pitch" ? isThemeName(themeParam) : isSkyThemeName(themeParam)) ? themeParam! : fallback;
  const s = await load(user);

  const src = `/api/${scene}/${user}${theme === fallback ? "" : `?theme=${theme}`}`;
  const pageHref = (sc: string, th: string) => {
    const q = new URLSearchParams();
    if (sc !== "skyline") q.set("scene", sc);
    if (th !== (sc === "pitch" ? DEFAULT_THEME : DEFAULT_SKY_THEME)) q.set("theme", th);
    const qs = q.toString();
    return `/u/${user}${qs ? `?${qs}` : ""}`;
  };
  const embed = `<a href="${SITE}/u/${user}"><img src="${SITE}${src}" alt="${user}'s GitHub ${scene}" width="100%"></a>`;
  const shareText = `My GitHub year as ${scene === "pitch" ? "a soccer match ⚽" : "the Toronto skyline 🏙️"} I'm a "${s.archetype.name}": ${s.total.toLocaleString("en-US")} commits, ${s.longestStreak.length}-day streak. What's yours?`;
  const shareUrl = `${SITE}/u/${user}`;
  const tweet = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  return (
    <main>
      <Link href="/" className="kicker" style={{ textDecoration: "none" }}>← Commit City</Link>

      <div className="role">
        <div className="emoji" aria-hidden>{s.archetype.emoji}</div>
        <div>
          <h2>@{user} · {s.archetype.name}</h2>
          <p>{s.archetype.tagline}</p>
        </div>
      </div>

      <div className="frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${user}'s contributions as a ${scene === "pitch" ? "soccer pitch" : "Toronto skyline"}`} width={960} height={420} />
      </div>

      <nav className="themes" aria-label="Scene">
        <Link className="chip" href={pageHref("skyline", DEFAULT_SKY_THEME)} aria-current={scene === "skyline"}>🏙️ Toronto skyline</Link>
        <Link className="chip" href={pageHref("pitch", DEFAULT_THEME)} aria-current={scene === "pitch"}>⚽ Soccer pitch</Link>
      </nav>
      <nav className="themes" aria-label="Theme">
        {themes.map((name) => (
          <Link key={name} className="chip" href={pageHref(scene, name)} aria-current={name === theme}>
            {name}
          </Link>
        ))}
      </nav>

      <div className="grid">
        <div className="stat"><b>{s.total.toLocaleString("en-US")}</b><span>contributions this season</span></div>
        <div className="stat"><b>{s.activeDays}</b><span>active days</span></div>
        <div className="stat"><b>{s.longestStreak.length}d</b><span>longest streak</span></div>
        <div className="stat"><b>{s.currentStreak}d</b><span>current streak</span></div>
        <div className="stat"><b>{s.bestDay.count}</b><span>best day ({s.bestDay.date})</span></div>
        <div className="stat"><b>{Math.round(s.weekendShare * 100)}%</b><span>on weekends</span></div>
      </div>

      <div className="row">
        <a className="btn" href={tweet} target="_blank" rel="noopener noreferrer">Share on X</a>
        <a className="btn ghost" href={linkedin} target="_blank" rel="noopener noreferrer">Share on LinkedIn</a>
        <CopyButton text={shareUrl} label="Copy link" />
      </div>

      <section className="embed">
        <h3>Put it in your README</h3>
        <pre>{embed}</pre>
        <CopyButton text={embed} label="Copy embed" />
      </section>

      <section className="embed">
        <h3>Check another profile</h3>
        <KickoffForm />
      </section>
    </main>
  );
}
