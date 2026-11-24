// Puzzle logic: swap this file to add new puzzle types.
export const TOL = 0.05; // aligned when every variable is within 5% of its range
export function newTargets(vars) {
  const t = {};
  for (const v of vars) t[v.key] = +(v.min + (0.1 + Math.random() * 0.8) * (v.max - v.min)).toFixed(1);
  return t;
}
// Player Two gets words and a rough band, never the exact number.
export function makeHints(vars, targets) {
  const words = ['barely there', 'gentle', 'steady', 'strong', 'overwhelming'], h = {};
  for (const v of vars) {
    const f = (targets[v.key] - v.min) / (v.max - v.min);
    h[v.key] = `${v.label} should feel ${words[Math.min(4, Math.floor(f * 5))]}, around ${Math.round(f * 10) * 10}% of the dial.`;
  }
  return h;
}
export function align(vars, values, targets) {
  const a = {};
  for (const v of vars) a[v.key] = Math.max(0, 1 - Math.abs(values[v.key] - targets[v.key]) / (v.max - v.min));
  return a;
}
export const isSolved = a => Object.values(a).every(x => x >= 1 - TOL);
export const render = (t, a, b) => t.replaceAll('{{a}}', a.profession).replaceAll('{{b}}', b.profession)
  .replaceAll('{{name_a}}', a.display_name).replaceAll('{{name_b}}', b.display_name);
