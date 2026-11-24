# Twinlight: co-op lighthouse for long-distance couples

## Run
```
createdb twinlight && psql twinlight -f db/schema.sql
cd server && npm i && DATABASE_URL=postgres:///twinlight JWT_SECRET=pick-a-long-secret npm start
```
Open http://localhost:3000 in two browsers (two accounts, one invite code).

## How the asymmetry works
Player One sees dials and a per-variable closeness grid. Player Two sees written clues only.
`targets` and `hints` sit in `puzzle_states`; `view()` in server.js filters them per role, so Player One's client never receives the answer.
Roles are randomly assigned each round.

## REST API (JWT in `Authorization: Bearer`)
| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | Create account / get token |
| POST | /api/couples | Create couple, returns invite_code |
| POST | /api/couples/join `{code}` | Partner joins, couple becomes active |
| GET | /api/puzzles | List puzzles |
| POST | /api/puzzles/:slug/start | New round, roles assigned, role-filtered state returned |
| GET | /api/states/:id | Fetch role-filtered state (reconnect) |
| PATCH | /api/states/:id/variables `{key,value}` | Player One sets a dial (REST fallback to WebSocket) |
| GET | /api/questions/next | Next unanswered prompt, rendered with both professions |
| POST | /api/memories `{state_id,question_id,prompt_text,answer}` | Commit answer; both partners' answers merge into one JSON row |
| GET | /api/memories | Shared timeline, newest first |

## WebSocket `/ws?token=JWT`
Client to server: `{type:"adjust", stateId, key, value}`
Server to client: `{type:"state", state}` (role-filtered) and `{type:"presence", online}`

## Next steps
Rate-limit auth routes, move JWT to an httpOnly cookie, add Redis pub/sub if you run more than one server, add more puzzle files in `puzzles.js`.

## Couple games (db/002_games.sql adds `game_sessions`; existing databases run that file)
| Method | Path | Purpose |
|---|---|---|
| POST | /api/games/:game/start | `tod`, `sync` or `notes`; pushes the new game to your partner |
| GET | /api/games/:game/current | Resume the active session (secret answers hidden until both lock in) |
| POST | /api/games/:id/act `{action,payload}` | Play a move. Actions: level, choose, reroll, done, pick, write, next, react |
WebSocket adds `{type:"game", game}`. Love Notes are saved to `memory_logs` when both partners have written.
Edit wording in `server/games.js` (`BANK`).
