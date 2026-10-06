/**
 * Screenshot proof helpers - shared by the upload endpoint, submit validation
 * and auto-validation. Kept pure (no DB / fs) so unit tests can cover them.
 */

export const MAX_PROOF_BYTES = 8 * 1024 * 1024; // 8 MB

/** Proof URLs we issue ourselves (content-addressed SHA-256 hex); rejects traversal / foreign hosts. */
export const PROOF_URL_RE = /^\/uploads\/proofs\/[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/;

export type ImageKind = 'png' | 'jpg' | 'webp' | 'gif';

/** Identify an image by magic bytes (never trust the client's content-type). */
export function detectImage(buf: Buffer | undefined | null): ImageKind | null {
  if (!buf || buf.length < 12) return null;
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'png';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return 'gif';
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Pull a well-formed screenshot URL out of a proof payload (null if absent/invalid). */
export function screenshotOf(payload: Record<string, unknown> | null | undefined): string | null {
  const s = payload?.screenshot;
  return typeof s === 'string' && PROOF_URL_RE.test(s) ? s : null;
}

/**
 * Structural proof checks for auto-validation. Returns a review reason or null.
 *
 * - A submitted screenshot IS the proof: the q1/q2 write-ups are gone, so text
 *   rules (requiredFields/minChars) do not apply when an image was uploaded.
 * - Tasks published with `{"proof":"screenshot"}` reject text-only payloads.
 * - Text-only payloads keep the original requiredFields/minChars behaviour.
 */
export function structuralFailure(
  rules: Record<string, any> | null | undefined,
  payload: Record<string, unknown>,
): string | null {
  if (payload?.screenshot !== undefined && payload.screenshot !== null && !screenshotOf(payload)) {
    return 'invalid screenshot reference';
  }
  const shot = screenshotOf(payload);
  if (rules?.proof === 'screenshot' && !shot) return 'screenshot proof required';
  if (shot) return null;

  const required: string[] = Array.isArray(rules?.requiredFields) ? rules.requiredFields : [];
  for (const field of required) {
    const v = payload[field];
    if (v === undefined || v === null || String(v).trim().length === 0) return `missing required field: ${field}`;
  }
  if (rules?.minChars) {
    const total = Object.values(payload).reduce<number>((s, v) => s + String(v).length, 0);
    if (total < Number(rules.minChars)) return 'insufficient detail in proof';
  }
  return null;
}
