"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function KickoffForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [user, setUser] = useState(initial);
  return (
    <form
      className="kickoff"
      onSubmit={(e) => {
        e.preventDefault();
        const u = user.trim().replace(/^@/, "");
        if (u) router.push(`/u/${encodeURIComponent(u)}`);
      }}
    >
      <input
        aria-label="GitHub username"
        placeholder="your GitHub username"
        value={user}
        onChange={(e) => setUser(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <button className="btn" type="submit">Build my city ⚡</button>
    </form>
  );
}
