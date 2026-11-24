# Scaffold prompts (paste in order into Claude Code, Cursor, or similar)

## 0. Shared context (paste first, keep in every session)
You are a senior full-stack engineer. Build "Twinlight", a synchronous co-op web app for long-distance couples.
Stack: Node 20 + Express + ws, PostgreSQL (pg, raw SQL), JWT auth with bcrypt, frontend in plain HTML/CSS with minimal JS (fetch + WebSocket only).
Rules: all user-facing copy lives in the HTML; images and logo live in /public/assets; no frameworks; explain nothing, output files.
Core concept: Player One manipulates environment dials. Player Two sees only written hints. The server alone knows the targets and never sends them to Player One.

## 1. Database
Write db/schema.sql for PostgreSQL with tables: users (profession, timezone), couples (user_a, user_b, invite_code, status; one couple per user),
puzzles (variables jsonb), puzzle_states (player_one, player_two, targets, hints, variables, alignment jsonb, status, attempts, solved_at),
progression_logs (event, payload jsonb), questions (template with {{a}} {{b}} {{name_a}} {{name_b}} placeholders, tags),
memory_logs (answers jsonb keyed by user id, UNIQUE on couple/state/question, GIN index on answers).
Add seed data: one 4-variable puzzle and 5 cross-disciplinary questions.

## 2. Auth and couples
Create server/server.js with a single POST /api/auth/enter (username + password only, creates the account on first use, bcrypt, JWT 90d), an auth middleware,
POST /api/couples (invite code) and POST /api/couples/join. Return plain-language error messages.

## 3. Puzzle engine
Create server/puzzles.js exporting newTargets, makeHints (words plus a rough band, never the exact value), align (0..1 per variable), isSolved (all within 5% of range).
Add POST /api/puzzles/:slug/start (randomly assign roles each round), GET /api/states/:id, PATCH /api/states/:id/variables (Player One only, clamp to min/max).
Write a view(state, userId) function that strips targets for everyone and hints for Player One. Log every adjustment to progression_logs.

## 4. Realtime
Add a ws server at /ws?token=JWT with one room per couple. Handle {type:"adjust"} by calling the same adjust() used by REST.
Broadcast role-filtered {type:"state"} to each socket individually, plus {type:"presence"}. Reconnect on the client after 2 seconds.

## 5. Question bank and memory timeline
GET /api/questions/next picks an unanswered question and renders placeholders with both partners' professions.
POST /api/memories upserts into memory_logs and merges each partner's JSON answer with `answers || new`.
GET /api/memories returns the timeline newest first.

## 6. Frontend
Create public/index.html, style.css, app.js. Sections: auth, pair, game, memory, timeline.
Palette: ink #12142a, dusk #6c6cf0, dawn #f5b94a, glow #8cf5d2. Fonts: Bricolage Grotesque headings, Newsreader body.
Central grid: one row per variable, 5 cells that light up with closeness. Player One gets range sliders that send over WebSocket; Player Two gets hint cards.
When status is "solved": grid border changes from a dusk-to-dawn gradient to solid glow green with a slow breathing animation, lit cells turn green.
Responsive down to 360px, visible focus rings, respect prefers-reduced-motion.

## 7. Hardening pass
Add rate limiting on auth, validate all request bodies, move the JWT to an httpOnly cookie, add CORS config and a Dockerfile plus docker-compose with Postgres.
Then write three integration tests: Player One never receives targets, only Player One can adjust, answers from both partners merge in one memory row.

## Extension prompts
- "Add a second puzzle type where Player Two controls one dial and Player One controls another, and both must match a hidden ratio."
- "Add a weekly digest endpoint that summarizes the memory timeline as JSON for email."
- "Add timezone-aware 'golden hour' scheduling so both partners get a reminder at a shared local time."

## 8. Couple games
Add a game_sessions table (couple_id, game, state jsonb, status) and server/games.js with three games driven by one reducer:
1) Truth or Dare: alternating turns, sweet/flirty levels, one reroll, "done" swaps turns and counts a shared heart.
2) Heart Sync: both partners secretly pick an answer, reveal together, matching answers glow and count toward a score over 5 rounds.
3) Love Notes: both finish a romantic sentence in secret, reveal together, and save the pair to memory_logs.
Never send a partner's secret answer until both have locked in. Broadcast {type:"game"} per socket. Frontend: a Games tab with three cards, card-flip reveals, floating hearts on matches/dones, and a "Send love" button available in every game. Escape all user text before rendering.
