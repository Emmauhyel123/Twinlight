// Couple games. Banks are plain arrays: edit the wording freely.
export const BANK = {
  truth: {
    sweet: ["What was your very first thought when you saw me?", "What’s a small thing I do that melts you?", "When did you realize you were falling for me?", "Which song makes you think of us, and why?", "What memory of us do you replay when we’re apart?", "What’s something you’ve always wanted to tell me?"],
    flirty: ["What do you miss most about being near me?", "Describe my smile in three words.", "What’s the most romantic thing you’ve imagined us doing?", "What’s the first thing you’ll do when we’re finally in the same room?", "What do you find most attractive about me that isn’t my looks?"]
  },
  dare: {
    sweet: ["Sing the chorus of a song that reminds you of us.", "Show me your view right now and describe it like a poem.", "Draw me in 60 seconds and hold it up to the camera.", "Say “I love you” in three languages. Best effort counts.", "Blow me a kiss and give me your best love-struck face.", "Tell me three things you’re grateful for about us, no pausing."],
    flirty: ["Give me a slow, dramatic compliment in a movie-trailer voice.", "Hold the most charming wink you have for five seconds.", "Plan our dream date out loud, like a restaurant critic.", "Whisper something sweet you’ve been saving up.", "Dance to a love song for 20 seconds. Camera on."]
  },
  sync: [
    { q: "Our perfect lazy Sunday?", o: ["Cuddled up with a movie", "Cooking together", "A long walk", "Sleeping in all day"] },
    { q: "Our dream first trip?", o: ["Beach sunrise", "Mountain cabin", "City lights", "Road trip"] },
    { q: "Which love language lands hardest?", o: ["Kind words", "Quality time", "Touch", "Gifts", "Helping out"] },
    { q: "When we finally meet, the first move is…", o: ["A long hug", "Running to each other", "Just smiling", "Happy tears"] },
    { q: "Date night in?", o: ["Candlelit dinner", "Board games", "Stargazing", "Dancing in the kitchen"] },
    { q: "Our song would be…", o: ["Slow and soft", "Upbeat and silly", "An old classic", "Big and dramatic"] }
  ],
  notes: ["I knew you were special when…", "Something I love about you that you don’t see is…", "My favorite moment with you so far is…", "One promise I’m making to us is…", "When I picture us in five years…"]
};
const draw = (arr, used) => {
  const key = x => x.q || x, free = arr.filter(x => !used.includes(key(x)));
  const p = (free.length ? free : arr)[Math.floor(Math.random() * (free.length || arr.length))];
  used.push(key(p)); return p;
};
export const GAMES = ['tod', 'sync', 'notes'];
export function init(game, c) {
  const s = { round: 1, reacts: 0, used: [] };
  if (game === 'tod') return { ...s, turn: c.user_a, phase: 'choose', level: 'sweet', hearts: 0, rerolls: 0 };
  if (game === 'sync') return { ...s, total: 5, picks: {}, revealed: false, matches: 0, q: draw(BANK.sync, s.used) };
  return { ...s, total: 3, text: {}, revealed: false, prompt: draw(BANK.notes, s.used) };
}
// Returns the next state, or null if the move isn't allowed right now.
export function act(game, st, uid, partner, a, p) {
  const s = structuredClone(st);
  if (a === 'react') { s.reacts++; s.reactBy = uid; return s; }
  if (game === 'tod') {
    if (a === 'level' && s.phase === 'choose' && ['sweet', 'flirty'].includes(p.level)) { s.level = p.level; return s; }
    if (a === 'choose' && s.phase === 'choose' && s.turn === uid && ['truth', 'dare'].includes(p.kind)) {
      s.kind = p.kind; s.prompt = draw(BANK[p.kind][s.level], s.used); s.phase = 'prompt'; s.rerolls = 0; return s; }
    if (a === 'reroll' && s.phase === 'prompt' && s.turn === uid && s.rerolls < 1) { s.prompt = draw(BANK[s.kind][s.level], s.used); s.rerolls++; return s; }
    if (a === 'done' && s.phase === 'prompt') { s.hearts++; s.donePulse = (s.donePulse || 0) + 1; s.phase = 'choose'; s.turn = s.turn === uid ? partner : uid; s.round++; return s; }
  }
  if (game === 'sync') {
    if (a === 'pick' && !s.revealed && s.picks[uid] == null && Number.isInteger(p.i) && p.i >= 0 && p.i < s.q.o.length) {
      s.picks[uid] = p.i;
      if (s.picks[partner] != null) { s.revealed = true; if (s.picks[uid] === s.picks[partner]) s.matches++; }
      return s; }
    if (a === 'next' && s.revealed) {
      if (s.round >= s.total) { s.finished = true; return s; }
      s.round++; s.picks = {}; s.revealed = false; s.q = draw(BANK.sync, s.used); return s; }
  }
  if (game === 'notes') {
    if (a === 'write' && !s.revealed && s.text[uid] == null && String(p.text || '').trim()) {
      s.text[uid] = String(p.text).trim().slice(0, 300);
      if (s.text[partner] != null) s.revealed = true; return s; }
    if (a === 'next' && s.revealed) {
      if (s.round >= s.total) { s.finished = true; return s; }
      s.round++; s.text = {}; s.revealed = false; s.prompt = draw(BANK.notes, s.used); return s; }
  }
  return null;
}
// Secret answers stay hidden until both partners have locked in.
export function gview(g, uid, names, partner) {
  const s = structuredClone(g.state);
  if (g.game === 'sync' && !s.revealed) { s.partnerReady = s.picks[partner] != null; s.picks = { [uid]: s.picks[uid] }; }
  if (g.game === 'notes' && !s.revealed) { s.partnerReady = s.text[partner] != null; s.text = { [uid]: s.text[uid] }; }
  delete s.used;
  return { id: g.id, game: g.game, me: uid, partner, names, state: s };
}
