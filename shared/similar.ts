/** Normalizes a name for duplicate checks: lowercase letters and digits only. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\b(inc|corp|co|enterprises?|trading|store)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Names that look like the same party (one contains the other, or only a typo apart). */
export function looksSimilar(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return Math.max(x.length, y.length) >= 5 && distance(x, y) <= 2;
}
