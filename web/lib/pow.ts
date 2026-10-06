'use client';

/**
 * Browser-side proof-of-work miner (mirrors src/common/pow.ts):
 * find a nonce where SHA-256(`${challenge}:${nonce}`) has `bits` leading zeros.
 * 14 bits ≈ 2^14 average attempts — sub-second on any modern device.
 */
export async function mineNonce(challenge: string, bits: number): Promise<string> {
  const enc = new TextEncoder();
  const fullBytes = Math.floor(bits / 8);
  const rem = bits % 8;

  for (let nonce = 0; nonce < 50_000_000; nonce++) {
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${nonce}`)),
    );
    let ok = true;
    for (let i = 0; i < fullBytes; i++) {
      if (digest[i] !== 0) {
        ok = false;
        break;
      }
    }
    if (ok && rem > 0 && (digest[fullBytes] >> (8 - rem)) !== 0) ok = false;
    if (ok) return String(nonce);
    if (nonce % 5000 === 0) await new Promise((r) => setTimeout(r, 0)); // keep UI responsive
  }
  throw new Error('Proof-of-work mining failed');
}
