// Loan schedules, straight-line (applies to every loan): equal principal and equal interest
// each month, the last row absorbing rounding.
//   total_interest     = installment × months − principal
//   interest_per_month = ROUND(total_interest ÷ months, 2)
//   principal_per_month = ROUND(principal ÷ months, 2)
//   last row: total − per_month × (months − 1), for both
// Every row must pay exactly the installment, and the rows must add up to the principal and the
// total interest to the centavo; otherwise the loan is rejected.

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

export interface Schedule {
  installments: Installment[];
  installmentCents: number;
  totalInterestCents: number;
  interestPerMonthCents: number;
  principalPerMonthCents: number;
  errors: string[];
}

export function buildSchedule(opts: { principalCents: number; months: number; firstDue: string; installmentCents: number }): Schedule {
  const { principalCents: principal, months, firstDue, installmentCents: installment } = opts;
  const errors: string[] = [];
  if (!(principal > 0)) errors.push("Enter the principal.");
  if (!(months > 0) || !Number.isInteger(months)) errors.push("Enter the number of months.");
  if (!(installment > 0)) errors.push("Enter the installment amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDue)) errors.push("Enter the first due date.");
  const totalInterest = installment * months - principal;
  if (errors.length) return { installments: [], installmentCents: installment, totalInterestCents: totalInterest, interestPerMonthCents: 0, principalPerMonthCents: 0, errors };
  if (totalInterest < 0) errors.push("The installments add up to less than the principal.");

  const interestPer = Math.round(totalInterest / months);
  const principalPer = Math.round(principal / months);
  const installments: Installment[] = [];
  for (let seq = 1; seq <= months; seq++) {
    const last = seq === months;
    installments.push({
      seq,
      dueDate: addMonths(firstDue, seq - 1),
      principalCents: last ? principal - principalPer * (months - 1) : principalPer,
      interestCents: last ? totalInterest - interestPer * (months - 1) : interestPer,
    });
  }
  const sumP = installments.reduce((s, i) => s + i.principalCents, 0);
  const sumI = installments.reduce((s, i) => s + i.interestCents, 0);
  if (sumP !== principal) errors.push("The schedule's principal doesn't add up to the loan.");
  if (sumI !== totalInterest) errors.push("The schedule's interest doesn't add up to the total interest.");
  const off = installments.find((i) => i.principalCents + i.interestCents !== installment);
  if (off) {
    errors.push(
      `Installment ${off.seq} would be ${((off.principalCents + off.interestCents) / 100).toFixed(2)}, not ${(installment / 100).toFixed(2)}: the rounded monthly principal and interest don't add up to the installment.`,
    );
  }
  return { installments, installmentCents: installment, totalInterestCents: totalInterest, interestPerMonthCents: interestPer, principalPerMonthCents: principalPer, errors };
}
