import { getContributions, UserNotFoundError } from "@/lib/contributions";
import { DEFAULT_SKY_THEME, renderSkyline, isSkyThemeName } from "@/lib/skyline";
import { computeStats } from "@/lib/stats";

export async function GET(request: Request, ctx: RouteContext<"/api/skyline/[user]">) {
  const { user: raw } = await ctx.params;
  const user = raw.replace(/\.svg$/i, "");
  const params = new URL(request.url).searchParams;
  const themeParam = params.get("theme");
  const theme = isSkyThemeName(themeParam) ? themeParam : DEFAULT_SKY_THEME;
  const still = params.get("still") === "1";

  try {
    const days = await getContributions(user);
    const svg = renderSkyline(user, days, computeStats(days), theme, still);
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    const notFound = err instanceof UserNotFoundError;
    const msg = notFound ? `No GitHub user "${user.slice(0, 39)}"` : "GitHub is taking a breather. Try again soon.";
    const safe = msg.replace(/[&<>"']/g, "");
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 120" width="960" height="120"><rect width="960" height="120" rx="16" fill="#0d1128"/><text x="480" y="66" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" fill="#fff">🟥 ${safe}</text></svg>`,
      {
        status: notFound ? 404 : 502,
        headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300" },
      },
    );
  }
}
