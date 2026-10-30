// Amounts are handled as whole centavos so sums never pick up floating-point errors.

export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[₱,\s]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

export function formatPeso(cents: number): string {
  return peso.format(fromCents(cents));
}
