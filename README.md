# Commit City 🏙️

Turn your GitHub year into an animated, hand-drawn scene for your profile README. There are two scenes.

By default it looks sketched: ink on grainy paper, wobbly pen lines that gently "boil" like frame-by-frame animation, watercolor washes, cross-hatching and handwritten notes.

## 🏙️ Toronto skyline (default)

- Each **week** is a tower. Busier weeks are taller.
- Each **day** is a lit window. Brighter windows mean more contributions.
- Your **best week** becomes the CN Tower, with a blinking beacon.
- The scene also has the Rogers Centre dome, a red streetcar on the waterfront, a plane crossing the sky, and the city reflected in Lake Ontario.
- Themes: `sketch` (default, ink on paper), `chalkboard`, and the flat `night`, `dusk`, `snow`

## ⚽ Soccer pitch

- Your contribution grid is laid out on the turf. The ball dribbles through each week's busiest day and scores.
- The scoreboard shows your contributions vs. **Bugs FC**, whose score is your number of weeks with zero commits.
- Themes: `sketch` (default), `chalkboard`, and the flat `classic`, `floodlight`, `retro`, `chalk`

## Your role

| Role | When |
| --- | --- |
| ⚡ Box-to-Box Engine | active on 75%+ of days |
| 🦾 Iron Man | 60+ day streak |
| 🍺 Sunday League Legend | 40%+ of contributions on weekends |
| ⭐ Wonderkid | last 30 days are 2× your average month |
| 🎯 Clinical Striker | quiet spells, then huge days |
| 🧢 Club Captain | weekdays only |
| 🎩 Midfield Maestro | steady and consistent |
| 🪑 Bench Warmer | no contributions yet |

## Add it to your README

No fork, Actions, or token needed:

```html
<a href="https://YOUR-DEPLOYMENT/u/YOUR_USERNAME">
  <img src="https://YOUR-DEPLOYMENT/api/skyline/YOUR_USERNAME" alt="My GitHub skyline" width="100%">
</a>
```

- For the soccer scene, swap `/api/skyline/` for `/api/pitch/`.
- `?theme=...` picks a theme, and `?still=1` gives a static image with no animation.

`/u/<username>` shows your stats and has share buttons plus a generated Open Graph card.

## Develop

```sh
npm install
npm run dev
```

Optional env vars:

- `GITHUB_TOKEN` uses the GraphQL API instead of the public calendar page
- `NEXT_PUBLIC_SITE_URL` sets the absolute URL used in embed snippets and share links

Only public daily contribution counts are read. Not affiliated with GitHub.
