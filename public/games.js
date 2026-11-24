const TL = window.TL, $ = id => document.getElementById(id), esc = TL.esc;
let g = null, lastId, lastR, lastD, lastV;

function hearts(n = 16) {
  for (let i = 0; i < n; i++) {
    const h = document.createElement('span'); h.className = 'heart'; h.textContent = '♥'; h.setAttribute('aria-hidden', 'true');
    h.style.left = Math.random() * 100 + 'vw'; h.style.fontSize = 16 + Math.random() * 24 + 'px'; h.style.animationDelay = Math.random() * .7 + 's';
    document.body.append(h); setTimeout(() => h.remove(), 3800);
  }
}
const act = (action, payload) => TL.api('/games/' + g.id + '/act', 'POST', { action, payload }).catch(e => alert(e.message));
const btn = (a, label, p, cls = '') => `<button class="${cls}" data-a="${a}"${p ? ` data-p='${JSON.stringify(p)}'` : ''}>${label}</button>`;

async function open(game) {
  document.querySelector(`[data-game="${game}"]`).classList.remove('live');
  g = (await TL.api('/games/' + game + '/current')) || (await TL.api('/games/' + game + '/start', 'POST'));
  $('hub').hidden = true; $('stage').hidden = false; lastId = null; draw();
}
function draw() {
  const s = g.state, me = g.me, ot = g.partner, you = esc(g.names[me]), them = esc(g.names[ot]);
  const matched = g.game === 'sync' && s.revealed && s.picks[me] === s.picks[ot], sealed = g.game === 'notes' && s.revealed, rv = matched || sealed ? s.round : 0;
  if (g.id === lastId && (s.reacts !== lastR || (s.donePulse || 0) !== lastD || (rv && rv !== lastV))) hearts();
  lastId = g.id; lastR = s.reacts; lastD = s.donePulse || 0; lastV = rv;
  const keep = $('nt')?.value || '';
  let h = btn('back', '← All games', null, 'back');

  if (g.game === 'tod') {
    const mine = s.turn === me, who = mine ? 'You' : them;
    h += `<p class="role">Round ${s.round}, ${s.hearts} hearts shared</p>`;
    if (s.phase === 'choose') {
      h += `<div class="chips">${btn('level', 'Sweet', { level: 'sweet' }, 'chip' + (s.level === 'sweet' ? ' on' : ''))}${btn('level', 'Flirty', { level: 'flirty' }, 'chip' + (s.level === 'flirty' ? ' on' : ''))}</div>`;
      h += mine ? `<h2>Your turn. Truth or dare?</h2><div class="big">${btn('choose', 'Truth', { kind: 'truth' })}${btn('choose', 'Dare', { kind: 'dare' }, 'd')}</div>` : `<h2>${them} is choosing…</h2>`;
    } else {
      h += `<div class="pcard ${s.kind}"><small>${s.kind === 'truth' ? 'Truth' : 'Dare'} for ${who === 'You' ? 'you' : them}</small><p>${esc(s.prompt)}</p></div>`;
      h += `<div class="row">${btn('done', 'Done, send love')}${mine && s.rerolls < 1 ? btn('reroll', 'Another one', null, 'ghost') : ''}</div>`;
    }
  }
  if (g.game === 'sync') {
    if (s.finished) h += `<h2>You matched on ${s.matches} of ${s.total}.</h2><p>${s.matches >= 4 ? 'Same heart, different cities.' : s.matches >= 2 ? 'Close enough to keep guessing each other for life.' : 'So much left to learn about each other. That’s the fun part.'}</p>${btn('new', 'Play again')}`;
    else {
      h += `<p class="role">Question ${s.round} of ${s.total}</p><h2>${esc(s.q.q)}</h2>`;
      if (!s.revealed) h += `<div class="opts">${s.q.o.map((o, i) => btn('pick', esc(o), { i }, 'opt' + (s.picks[me] === i ? ' mine' : ''))).join('')}</div><p>${s.picks[me] != null ? (s.partnerReady ? 'Revealing…' : `Locked in. Waiting for ${them}…`) : 'Pick what feels most like you. Matches make you glow.'}</p>`;
      else h += `<div class="duo ${matched ? 'match' : ''}"><div><small>${you}</small><p>${esc(s.q.o[s.picks[me]])}</p></div><div><small>${them}</small><p>${esc(s.q.o[s.picks[ot]])}</p></div></div><p>${matched ? 'Same heart.' : 'Different picks. Tell each other why.'}</p>${btn('next', s.round >= s.total ? 'See result' : 'Next question')}`;
    }
  }
  if (g.game === 'notes') {
    if (s.finished) h += `<h2>${s.total} notes, saved to your timeline.</h2>${btn('new', 'Write more')}`;
    else {
      h += `<p class="role">Note ${s.round} of ${s.total}</p><h2>${esc(s.prompt)}</h2>`;
      if (!s.revealed) h += s.text[me] != null ? `<div class="pcard"><p>${esc(s.text[me])}</p></div><p>Sealed. Waiting for ${them}…</p>` : `<textarea id="nt" maxlength="300" placeholder="Write from the heart. ${them} can’t see it until you’ve both written.">${esc(keep)}</textarea><button id="seal">Seal my note</button>`;
      else h += `<div class="duo match"><div><small>${you}</small><p>${esc(s.text[me])}</p></div><div><small>${them}</small><p>${esc(s.text[ot])}</p></div></div><p>Saved to your timeline.</p>${btn('next', s.round >= s.total ? 'Finish' : 'Next note')}`;
    }
  }
  h += btn('react', '♥ Send love', null, 'heartbtn');
  $('stage').innerHTML = h;
  $('seal')?.addEventListener('click', () => act('write', { text: $('nt').value }));
}
$('stage').addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a === 'back') { g = null; $('stage').hidden = true; $('hub').hidden = false; return; }
  if (b.dataset.a === 'new') { g = await TL.api('/games/' + g.game + '/start', 'POST'); return draw(); }
  act(b.dataset.a, b.dataset.p ? JSON.parse(b.dataset.p) : {});
});
document.querySelectorAll('.gcard').forEach(c => c.onclick = () => open(c.dataset.game).catch(e => alert(e.message)));
TL.onGame = v => { if (g && v.game === g.game) { g = v; draw(); } else if (!g) document.querySelector(`[data-game="${v.game}"]`)?.classList.add('live'); };
