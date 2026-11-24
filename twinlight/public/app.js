// JS only for API calls + WebSocket sync. Copy and layout live in index.html.
const $ = id => document.getElementById(id);
let token = localStorage.getItem('tl_token'), ws, state;
const api = async (path, method = 'GET', body) => {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error); return j;
};
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.TL = { api, esc };
const show = (...ids) => { ['auth', 'pair', 'game', 'games', 'memory', 'timeline'].forEach(i => $(i).hidden = !ids.includes(i)); $('tabs').hidden = ids.includes('auth') || ids.includes('pair'); };
let tabName = 'game';
function go(t) { if (t) tabName = t; document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tabName));
  show(tabName, ...(tabName === 'game' && window.TL.solved ? ['memory'] : [])); }
document.querySelectorAll('.tab').forEach(b => b.onclick = () => go(b.dataset.tab));

async function signIn(path) {
  try {
    const b = { email: $('email').value, password: $('password').value, display_name: $('name').value, profession: $('profession').value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    token = (await api('/auth/' + path, 'POST', b)).token; localStorage.setItem('tl_token', token); boot();
  } catch (e) { $('authErr').textContent = e.message; }
}
$('login').onclick = () => signIn('login'); $('register').onclick = () => signIn('register');
$('makeInvite').onclick = async () => { $('inviteOut').textContent = 'Share this code: ' + (await api('/couples', 'POST')).invite_code; };
$('join').onclick = async () => { try { await api('/couples/join', 'POST', { code: $('code').value }); boot(); } catch (e) { $('inviteOut').textContent = e.message; } };
$('startBtn').onclick = async () => render(await api('/puzzles/lighthouse/start', 'POST'));

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${token}`);
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.type === 'state') render(m.state);
    if (m.type === 'game') window.TL.onGame?.(m.game);
    if (m.type === 'presence') { $('presence').textContent = m.online > 1 ? 'Partner online' : 'Partner offline'; $('presence').classList.toggle('on', m.online > 1); } };
  ws.onclose = () => token && setTimeout(connect, 2000);
}

function render(s) {
  state = s; window.TL.solved = s.status === 'solved'; go();
  $('roleLine').textContent = s.role === 'one' ? 'You hold the dials. Your partner holds the clues.' : 'You hold the clues. Your partner holds the dials.';
  const keys = Object.keys(s.alignment), labels = s.vars ? Object.fromEntries(s.vars.map(v => [v.key, v.label])) : {};
  $('grid').classList.toggle('aligned', s.status === 'solved');
  $('grid').innerHTML = keys.map(k => { const lit = Math.round(s.alignment[k] * 5), done = s.alignment[k] >= .95;
    return `<div class="vrow ${done ? 'done' : ''}"><b>${labels[k] || k}</b><div class="cells">${[0,1,2,3,4].map(i => `<i class="cell ${i < lit ? 'lit' : ''}"></i>`).join('')}</div></div>`; }).join('');
  if (s.role === 'two') $('controls').innerHTML = Object.values(s.hints).map(h => `<p class="hint">${h}</p>`).join('');
  else if (!$('controls').querySelector('input') || s.status !== 'active') $('controls').innerHTML = s.vars.map(v =>
    `<label class="ctl"><b>${v.label}</b><input type="range" min="${v.min}" max="${v.max}" step="0.1" value="${s.values[v.key]}" data-k="${v.key}" ${s.status === 'solved' ? 'disabled' : ''}><output>${s.values[v.key]}${v.unit}</output></label>`).join('');
  $('status').textContent = s.status === 'solved' ? `Aligned after ${s.attempts} adjustments. The lamp is lit.` : 'Describe your clues out loud. Tune until every row glows.';
  if (s.status === 'solved') loadPrompt();
}
$('controls').addEventListener('input', e => { if (e.target.dataset.k) {
  e.target.nextElementSibling.textContent = e.target.value;
  ws.send(JSON.stringify({ type: 'adjust', stateId: state.id, key: e.target.dataset.k, value: e.target.value })); } });

let current;
async function loadPrompt() { current = await api('/questions/next'); $('prompt').textContent = current.done ? 'You have answered every question. New ones are coming.' : current.prompt; }
$('save').onclick = async () => {
  await api('/memories', 'POST', { state_id: state.id, question_id: current.id, prompt_text: current.prompt, answer: { text: $('answer').value, at: new Date().toISOString() } });
  $('answer').value = ''; loadTimeline();
};
async function loadTimeline() {
  $('tl').innerHTML = (await api('/memories')).map(m => `<li><small>${new Date(m.created_at).toLocaleDateString()}</small><p><i>${esc(m.prompt_text)}</i></p>${Object.values(m.answers).map(a => `<p>${esc(a.text)}</p>`).join('')}</li>`).join('');
}
async function boot() {
  if (!token) return show('auth');
  try { await api('/memories'); go(); connect(); loadTimeline(); }
  catch (e) { show(e.message.includes('Sign in') ? 'auth' : 'pair'); }
}
boot();
