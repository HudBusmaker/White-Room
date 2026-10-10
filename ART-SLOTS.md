# White Room — artwork

All old artwork (cartoon art, anime concept boards, `art.svg`, the `.pre-anime2` backups) has been deleted.
The site now uses five pictures in `public/assets/art/`, all WebP:

| File | Used on | Source picture | Notes |
|------|---------|----------------|-------|
| login.webp     | Login (left half) **and** Registration (right half) | Hero with the glowing π aura | One file for both halves, cropped differently in `style.css` |
| dashboard.webp | "Continue Learning" card on the dashboard | Hero with floating screens | Mirrored so he stands on the right and the text sits on the left |
| lessons.webp   | Side picture on the Lessons page | Hero thinking, π and quote cards | Carries its own captions, so no text is added on top |
| compete.webp   | Picture under Competition Rewards | The group with the trophy | Background removed (transparent WebP) |
| quest.webp     | Right side of the Daily Quest banner | Dungeon Gate | Background removed (transparent WebP); fades out to the left |

- Each slot still has a pure-CSS navy gradient behind it (`--art-fallback`), so a missing or slow image never breaks a page.
- To swap a picture, replace the file with the same name (WebP, ideally under 100 KB). The focal point per slot is the `--pos` value in `style.css` (search `artwork slots`).
- Compete and quest are cut-outs: the original files had a checkerboard background baked in, which was removed.
- On phones the sign-in pictures become a short banner with the logo; the quote text and tagline are hidden there.
- Rank badges, charts, icons and the π logo are CSS/SVG, not images.
