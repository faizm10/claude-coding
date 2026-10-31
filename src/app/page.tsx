import { KickoffForm } from "./KickoffForm";

export default function Home() {
  return (
    <main>
      <div className="kicker">Commit City</div>
      <h1>
        Your GitHub year,
        <br />
        built as <em>a city.</em>
      </h1>
      <p className="lede">
        Every week you ship becomes a tower on the Toronto skyline, and every day lights a window. Your best
        week becomes the CN Tower. Prefer football? Switch to the soccer pitch. Live README embed, no forks or tokens.
      </p>
      <KickoffForm />
      <div className="frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/skyline/torvalds" alt="Example Toronto skyline for torvalds" width={960} height={420} />
      </div>
      <div className="frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/pitch/torvalds?theme=chalkboard" alt="Example soccer pitch for torvalds" width={960} height={420} />
      </div>
      <footer>Reads only public daily contribution counts. Not affiliated with GitHub.</footer>
    </main>
  );
}
