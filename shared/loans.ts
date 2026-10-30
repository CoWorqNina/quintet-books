// Loan schedules: each installment split into principal and interest. Built from the agreed
// annual rate, or from the lender's fixed installment amount (rate solved), or interest-free.

export interface Installment {
  seq: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
}

/** Same day of month, `n` months later (clamped to the month's last day). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

function payment(principal: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/** Monthly rate that makes `months` equal installments of `installment` repay `principal`. */
export function solveMonthlyRate(principal: number, installment: number, months: number): number {
  if (installment * months <= principal) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (payment(principal, mid, months) > installment) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function buildSchedule(opts: {
  principalCents: number;
  months: number;
  firstDue: string;
  annualRatePct?: number;
  installmentCents?: number;
}): { installments: Installment[]; annualRatePct: number; installmentCents: number } {
  const { principalCents, months, firstDue } = opts;
  const monthlyRate = opts.installmentCents
    ? solveMonthlyRate(principalCents, opts.installmentCents, months)
    : (opts.annualRatePct ?? 0) / 100 / 12;
  const installmentCents = opts.installmentCents ?? Math.round(payment(principalCents, monthlyRate, months));
  const installments: Installment[] = [];
  let balance = principalCents;
  for (let seq = 1; seq <= months; seq++) {
    const interestCents = Math.round(balance * monthlyRate);
    const principal = seq === months ? balance : Math.min(balance, installmentCents - interestCents);
    installments.push({ seq, dueDate: addMonths(firstDue, seq - 1), principalCents: principal, interestCents });
    balance -= principal;
  }
  return { installments, annualRatePct: Math.round(monthlyRate * 12 * 100 * 10000) / 10000, installmentCents };
}
