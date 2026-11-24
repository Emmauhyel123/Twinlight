import express from 'express'; import http from 'http'; import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken'; import bcrypt from 'bcrypt'; import pg from 'pg'; import crypto from 'crypto'; import path from 'path'; import { fileURLToPath } from 'url';
import { GAMES, init, act as gact, gview } from './games.js';
import { newTargets, makeHints, align, isSolved, render } from './puzzles.js';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('Set JWT_SECRET in your host’s environment variables.');
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';
const DB_URL = process.env.DATABASE_URL || '';   // hosted databases (Supabase, Render, Neon) need SSL
const db = new pg.Pool({ connectionString: DB_URL, ssl: DB_URL.includes('@') && !/localhost|127\.0\.0\.1/.test(DB_URL) ? { rejectUnauthorized: false } : false });
const q = (s, p) => db.query(s, p).then(r => r.rows);
const app = express(); app.use(express.json()); app.get('/healthz', (_, res) => res.send('ok'));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '90d' });
const auth = (req, res, next) => {
  try { req.uid = jwt.verify((req.headers.authorization || '').slice(7), SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Sign in again.' }); }
};
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Something went wrong. Try again.' }); });

// ---- Auth: one step. New username = account created, existing = log in.
app.post('/api/auth/enter', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase(), password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username: 3 to 20 letters, numbers or underscores.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password needs at least 4 characters.' });
  let [u] = await q('SELECT * FROM users WHERE username=$1', [username]);
  if (u) { if (!(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'That username is taken, or the password is wrong.' }); }
  else [u] = await q('INSERT INTO users(username,password_hash,display_name,profession) VALUES($1,$2,$1,$3) RETURNING id',
    [username, await bcrypt.hash(password, 10), String(req.body.profession || '').trim().slice(0, 40) || 'dreamer']);
  res.json({ token: sign(u) });
}));

// ---- Couples (relationship mapping)
const myCouple = async uid => (await q(`SELECT * FROM couples WHERE (user_a=$1 OR user_b=$1) AND status='active'`, [uid]))[0];
app.post('/api/couples', auth, wrap(async (req, res) => {
  const [c] = await q('INSERT INTO couples(user_a,invite_code) VALUES($1,$2) RETURNING *', [req.uid, crypto.randomBytes(4).toString('hex')]);
  res.json(c);
}));
app.post('/api/couples/join', auth, wrap(async (req, res) => {
  const [c] = await q(`UPDATE couples SET user_b=$1,status='active' WHERE invite_code=$2 AND user_b IS NULL AND user_a<>$1 RETURNING *`, [req.uid, req.body.code]);
  c ? res.json(c) : res.status(404).json({ error: 'Invite code not found or already used.' });
}));

// ---- Puzzles & state. view() is the asymmetry: targets never leave the server.
const view = (s, uid, vars) => ({
  id: s.id, status: s.status, role: uid === s.player_one ? 'one' : 'two', alignment: s.alignment, attempts: s.attempts,
  ...(uid === s.player_one ? { vars, values: s.variables } : { hints: s.hints })
});
app.get('/api/puzzles', auth, wrap(async (_, res) => res.json(await q('SELECT id,slug,title,difficulty FROM puzzles'))));
app.post('/api/puzzles/:slug/start', auth, wrap(async (req, res) => {
  const c = await myCouple(req.uid); if (!c) return res.status(400).json({ error: 'Connect with your partner first.' });
  const [p] = await q('SELECT * FROM puzzles WHERE slug=$1', [req.params.slug]);
  const t = newTargets(p.variables), start = Object.fromEntries(p.variables.map(v => [v.key, v.min]));
  const [one, two] = Math.random() < .5 ? [c.user_a, c.user_b] : [c.user_b, c.user_a]; // roles swap each round
  const [s] = await q(`INSERT INTO puzzle_states(couple_id,puzzle_id,player_one,player_two,targets,hints,variables,alignment)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [c.id, p.id, one, two, t, makeHints(p.variables, t), start, align(p.variables, start, t)]);
  await q(`INSERT INTO progression_logs(state_id,actor_id,event) VALUES($1,$2,'start')`, [s.id, req.uid]);
  broadcast(c.id, s, p.variables); res.json(view(s, req.uid, p.variables));
}));
app.get('/api/states/:id', auth, wrap(async (req, res) => {
  const [s] = await q(`SELECT s.*, p.variables AS vars FROM puzzle_states s JOIN puzzles p ON p.id=s.puzzle_id
    WHERE s.id=$1 AND $2 IN (s.player_one,s.player_two)`, [req.params.id, req.uid]);
  s ? res.json(view(s, req.uid, s.vars)) : res.status(404).json({ error: 'Puzzle not found.' });
}));
async function adjust(uid, stateId, key, value) { // shared by REST and WebSocket
  const [s] = await q(`SELECT s.*, p.variables AS vars FROM puzzle_states s JOIN puzzles p ON p.id=s.puzzle_id
    WHERE s.id=$1 AND s.player_one=$2 AND s.status='active'`, [stateId, uid]);
  const v = s?.vars.find(x => x.key === key); if (!v) return null;
  const vals = { ...s.variables, [key]: Math.min(v.max, Math.max(v.min, +value)) };
  const al = align(s.vars, vals, s.targets), done = isSolved(al);
  const [n] = await q(`UPDATE puzzle_states SET variables=$2,alignment=$3,attempts=attempts+1,status=$4,
    solved_at=CASE WHEN $4='solved' THEN now() END WHERE id=$1 RETURNING *`, [stateId, vals, al, done ? 'solved' : 'active']);
  await q('INSERT INTO progression_logs(state_id,actor_id,event,payload) VALUES($1,$2,$3,$4)', [stateId, uid, done ? 'solved' : 'adjust', { key, value: vals[key] }]);
  broadcast(n.couple_id, n, s.vars); return n;
}
app.patch('/api/states/:id/variables', auth, wrap(async (req, res) => {
  const n = await adjust(req.uid, req.params.id, req.body.key, req.body.value);
  n ? res.json({ alignment: n.alignment, status: n.status }) : res.status(403).json({ error: 'Only Player One can change the dials.' });
}));

// ---- Question bank & memory timeline
app.get('/api/questions/next', auth, wrap(async (req, res) => {
  const c = await myCouple(req.uid);
  const [a] = await q('SELECT * FROM users WHERE id=$1', [req.uid]), [b] = await q('SELECT * FROM users WHERE id=$1', [c.user_a === req.uid ? c.user_b : c.user_a]);
  const [qq] = await q(`SELECT * FROM questions WHERE id NOT IN (SELECT question_id FROM memory_logs WHERE couple_id=$1 AND question_id IS NOT NULL) ORDER BY random() LIMIT 1`, [c.id]);
  qq ? res.json({ id: qq.id, prompt: render(qq.template, a, b) }) : res.json({ done: true });
}));
app.post('/api/memories', auth, wrap(async (req, res) => { // each partner's answer merges into one row
  const c = await myCouple(req.uid), { state_id, question_id, prompt_text, answer } = req.body;
  const [m] = await q(`INSERT INTO memory_logs(couple_id,state_id,question_id,prompt_text,answers)
    VALUES($1,$2,$3,$4,jsonb_build_object($5::text,$6::jsonb))
    ON CONFLICT (couple_id,state_id,question_id) DO UPDATE SET answers = memory_logs.answers || EXCLUDED.answers RETURNING *`,
    [c.id, state_id, question_id, prompt_text, req.uid, JSON.stringify(answer)]);
  res.json(m);
}));
app.get('/api/memories', auth, wrap(async (req, res) => {
  const c = await myCouple(req.uid);
  res.json(await q('SELECT * FROM memory_logs WHERE couple_id=$1 ORDER BY created_at DESC LIMIT 50', [c.id]));
}));

// ---- Couple games (state in game_sessions; role-filtered per socket)
const gameRow = async (id, uid) => (await q(`SELECT g.*, c.user_a, c.user_b FROM game_sessions g JOIN couples c ON c.id=g.couple_id
  WHERE g.id=$1 AND $2 IN (c.user_a,c.user_b)`, [id, uid]))[0];
const namesOf = async g => Object.fromEntries((await q('SELECT id,display_name FROM users WHERE id=ANY($1)', [[g.user_a, g.user_b]])).map(u => [u.id, u.display_name]));
const other = (g, uid) => g.user_a === uid ? g.user_b : g.user_a;
async function pushGame(g) {
  const n = await namesOf(g);
  for (const ws of rooms.get(g.couple_id) || []) ws.send(JSON.stringify({ type: 'game', game: gview(g, ws.uid, n, other(g, ws.uid)) }));
}
app.post('/api/games/:game/start', auth, wrap(async (req, res) => {
  const c = await myCouple(req.uid);
  if (!c || !GAMES.includes(req.params.game)) return res.status(400).json({ error: 'Connect with your partner first.' });
  await q(`UPDATE game_sessions SET status='finished' WHERE couple_id=$1 AND game=$2 AND status='active'`, [c.id, req.params.game]);
  const [row] = await q('INSERT INTO game_sessions(couple_id,game,state) VALUES($1,$2,$3) RETURNING *', [c.id, req.params.game, init(req.params.game, c)]);
  const g = { ...row, user_a: c.user_a, user_b: c.user_b }; await pushGame(g);
  res.json(gview(g, req.uid, await namesOf(g), other(g, req.uid)));
}));
app.get('/api/games/:game/current', auth, wrap(async (req, res) => {
  const c = await myCouple(req.uid);
  const [row] = await q(`SELECT * FROM game_sessions WHERE couple_id=$1 AND game=$2 AND status='active' ORDER BY created_at DESC LIMIT 1`, [c.id, req.params.game]);
  if (!row) return res.json(null);
  const g = { ...row, user_a: c.user_a, user_b: c.user_b };
  res.json(gview(g, req.uid, await namesOf(g), other(g, req.uid)));
}));
app.post('/api/games/:id/act', auth, wrap(async (req, res) => {
  const g = await gameRow(req.params.id, req.uid); if (!g) return res.status(404).json({ error: 'Game not found.' });
  const s = gact(g.game, g.state, req.uid, other(g, req.uid), req.body.action, req.body.payload || {});
  if (!s) return res.status(400).json({ error: 'That move isn’t available right now.' });
  const [u] = await q('UPDATE game_sessions SET state=$2,status=$3 WHERE id=$1 RETURNING *', [g.id, s, s.finished ? 'finished' : 'active']);
  if (g.game === 'notes' && s.revealed && !g.state.revealed)   // sealed notes become timeline memories
    await q('INSERT INTO memory_logs(couple_id,prompt_text,answers) VALUES($1,$2,$3)', [g.couple_id, s.prompt,
      JSON.stringify(Object.fromEntries(Object.entries(s.text).map(([k, v]) => [k, { text: v, game: 'love-notes' }])))]);
  await pushGame({ ...u, user_a: g.user_a, user_b: g.user_b }); res.json({ ok: true });
}));

// ---- WebSockets: one room per couple
const server = http.createServer(app), wss = new WebSocketServer({ server, path: '/ws' }), rooms = new Map();
function broadcast(cid, s, vars) { for (const ws of rooms.get(cid) || []) ws.send(JSON.stringify({ type: 'state', state: view(s, ws.uid, vars) })); }
const presence = id => { const r = rooms.get(id); if (r) for (const w of r) w.send(JSON.stringify({ type: 'presence', online: r.size })); };
wss.on('connection', (ws, req) => {
  try { ws.uid = jwt.verify(new URL(req.url, 'http://x').searchParams.get('token'), SECRET).id; } catch { return ws.close(4401); }
  myCouple(ws.uid).then(c => {
    if (!c) return ws.close(4400);
    ws.cid = c.id; (rooms.get(c.id) || rooms.set(c.id, new Set()).get(c.id)).add(ws); presence(c.id);
  });
  ws.on('message', async raw => { const m = JSON.parse(raw); if (m.type === 'adjust') await adjust(ws.uid, m.stateId, m.key, m.value); });
  ws.on('close', () => { rooms.get(ws.cid)?.delete(ws); presence(ws.cid); });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Twinlight listening on ' + PORT));
