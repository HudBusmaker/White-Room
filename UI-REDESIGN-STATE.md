# White Room UI — state (7 Oct 2026)

Built to the owner's "interface design" board. Dark navy shell, fixed left sidebar,
white content cards, blue/cyan actions, violet + gold for rank and XP. Every earlier
cartoon trace is removed (fonts, art.svg, doodle styles, backups).

- Everything visual is CSS or inline SVG: hexagon rank badges, donut and ring charts,
  icons, tiles, calendar. No external fonts or requests.
- Artwork lives in replaceable slots: see ART-SLOTS.md.
- Screens: login/staff login, registration, student dashboard, lessons, lesson session,
  daily quest, compete, rankings, profile, marking quest, and Head Staff dashboard,
  marking review (list + detail), students, admissions, competitions (placeholder).
- Responsive: sidebar becomes a slide-in drawer under 900 px; tested at 1440 and 390 wide.

Tested: validate, 31 smoke checks, and a Chromium pass over every screen at desktop and
phone width with seeded fake data, no script errors. NOT tested: a real Android phone,
real handwriting marking (no AI key in the build sandbox), Safari/Firefox.

Deliberate gaps (not faked): competition engine, admission-key history list (needs a
GET endpoint), date of birth (not collected on purpose), "remember me" remembers the
student ID only, never the password.
