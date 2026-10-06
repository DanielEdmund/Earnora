/** Money is ALWAYS integer kobo. ₦1 = 100 kobo. No floats touch the ledger. */

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

export function formatNaira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Applies basis points to an amount, rounding down in favour of solvency. */
export function applyBps(amountKobo: number, bps: number): number {
  return Math.floor((amountKobo * bps) / 10_000);
}
