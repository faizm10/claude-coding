import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getPlayer } from "@/lib/player";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Commit Pitch player card";

export default async function OG({ params }: { params: Promise<{ user: string }> }) {
  const { user } = await params;
  const s = await getPlayer(user);
  if (!s) notFound();
  const stat = (v: string, label: string) => (
    <div style={{ display: "flex", flexDirection: "column", padding: "20px 28px", background: "#0e2617", borderRadius: 20, border: "2px solid #1f4a2c" }}>
      <div style={{ display: "flex", fontSize: 56, fontWeight: 800, color: "#fff" }}>{v}</div>
      <div style={{ display: "flex", fontSize: 24, color: "#9cc6a6" }}>{label}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: 64, background: "linear-gradient(90deg,#1f7a3a 0%,#1a6d33 50%,#1f7a3a 100%)", color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, letterSpacing: 6, fontWeight: 800, color: "#d9ff6b" }}>
          <span style={{ display: "flex" }}>COMMIT PITCH ⚽</span>
          <span>{`@${user.toUpperCase()}`}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 34, color: "#e9f7ec" }}>Player role</div>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 900, lineHeight: 1 }}>{`${s.archetype.emoji} ${s.archetype.name}`}</div>
          <div style={{ display: "flex", fontSize: 32, color: "#e9f7ec", marginTop: 12 }}>{s.archetype.tagline}</div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {stat(s.total.toLocaleString("en-US"), "contributions")}
          {stat(`${s.longestStreak.length}d`, "longest streak")}
          {stat(String(s.activeDays), "matchdays")}
        </div>
      </div>
    ),
    size,
  );
}
