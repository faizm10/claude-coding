export type Day = { date: string; count: number };

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function isValidUsername(user: string) {
  return USERNAME_RE.test(user);
}

export class UserNotFoundError extends Error {}

/**
 * Fetches a user's public contribution calendar (last ~year of daily counts).
 * Uses the GraphQL API when GITHUB_TOKEN is set (includes private counts the
 * user chose to show); otherwise reads the public calendar fragment.
 */
export async function getContributions(user: string): Promise<Day[]> {
  if (!isValidUsername(user)) throw new UserNotFoundError(user);
  const token = process.env.GITHUB_TOKEN;
  const days = token ? await viaGraphQL(user, token) : await viaPublicCalendar(user);
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

async function viaGraphQL(user: string, token: string): Promise<Day[]> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
      variables: { login: user },
    }),
    next: { revalidate: 21600 },
  });
  const json = await res.json();
  const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new UserNotFoundError(user);
  return weeks.flatMap((w: { contributionDays: { date: string; contributionCount: number }[] }) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
}

async function viaPublicCalendar(user: string): Promise<Day[]> {
  const res = await fetch(`https://github.com/users/${user}/contributions`, {
    headers: { "User-Agent": "commit-pitch" },
    next: { revalidate: 21600 },
  });
  if (res.status === 404) throw new UserNotFoundError(user);
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const html = await res.text();

  const dateById = new Map<string, string>();
  for (const m of html.matchAll(/<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="([^"]+)"/g)) {
    dateById.set(m[2], m[1]);
  }
  const days: Day[] = [];
  for (const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const date = dateById.get(m[1]);
    if (!date) continue;
    const n = m[2].match(/^([\d,]+) contribution/);
    days.push({ date, count: n ? Number(n[1].replace(/,/g, "")) : 0 });
  }
  if (days.length === 0) throw new UserNotFoundError(user);
  return days;
}
