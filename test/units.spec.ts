import { createHash } from 'node:crypto';
import { hasLeadingZeroBits } from '../src/common/pow';
import { applyBps, formatNaira, nairaToKobo } from '../src/common/money';
import { currentWindowDate, isWindowOpen, nowInTz, parseWindow, windowStatus } from '../src/common/time';
import { detectImage, MAX_PROOF_BYTES, screenshotOf, structuralFailure } from '../src/tasks/proof';

describe('money helpers', () => {
  test('naira ↔ kobo round-trip is exact (no floats leak)', () => {
    expect(nairaToKobo(1000)).toBe(100_000);
    expect(nairaToKobo(0.30)).toBe(30);
    expect(formatNaira(100_000)).toContain('1,000');
  });

  test('basis points commission rounds down (solvency)', () => {
    expect(applyBps(100_000, 1500)).toBe(15_000); // 15% of ₦1,000
    expect(applyBps(100_000, 500)).toBe(5_000); // 5%
    expect(applyBps(100_000, 250)).toBe(2_500); // 2.5%
    expect(applyBps(333, 1500)).toBe(49); // floors, never rounds up
  });
});

describe('withdrawal windows (WAT)', () => {
  test('parses valid range and rejects midnight-crossing', () => {
    expect(parseWindow('17:00-19:00')).toEqual({ startMin: 17 * 60, endMin: 19 * 60 });
    expect(() => parseWindow('23:00-01:00')).toThrow();
    expect(() => parseWindow('nope')).toThrow();
  });

  test('window open/closed evaluation', () => {
    const tz = 'Africa/Lagos';
    const realNow = Date.now;
    try {
      // 18:00 Lagos time on a fixed date
      Date.now = () => Date.UTC(2026, 8, 22, 17, 0, 0); // Lagos = UTC+1
      expect(isWindowOpen('17:00-19:00', tz)).toBe(true);
      expect(isWindowOpen('19:00-21:00', tz)).toBe(false);
      expect(nowInTz(tz).hour).toBe(18);
      expect(currentWindowDate(tz)).toBe('2026-09-22');
      const status = windowStatus('17:00-19:00', tz);
      expect(status.open).toBe(true);

      Date.now = () => Date.UTC(2026, 8, 22, 20, 0, 0); // 21:00 Lagos → closed
      expect(isWindowOpen('17:00-19:00', tz)).toBe(false);
      const closed = windowStatus('17:00-19:00', tz);
      expect(closed.opensAt).toBe('2026-09-23T17:00:00');
      expect(closed.minutesUntilOpen).toBe(20 * 60);
    } finally {
      Date.now = realNow;
    }
  });
});

describe('proof-of-work', () => {
  test('leading zero bit counting', () => {
    expect(hasLeadingZeroBits(Buffer.from([0x00, 0x0f]), 8)).toBe(true);
    expect(hasLeadingZeroBits(Buffer.from([0x01, 0x0f]), 8)).toBe(false);
    expect(hasLeadingZeroBits(Buffer.from([0x00, 0x0f]), 12)).toBe(true); // top nibble is zero
    expect(hasLeadingZeroBits(Buffer.from([0x00, 0xff]), 12)).toBe(false); // top nibble is 0xF
    expect(hasLeadingZeroBits(Buffer.from([0x00, 0x1f]), 12)).toBe(false); // top nibble is 0x1
    expect(hasLeadingZeroBits(Buffer.from([0x00, 0x10]), 13)).toBe(false); // 5th bit of 2nd byte set
    expect(hasLeadingZeroBits(Buffer.from([0x00, 0x07]), 13)).toBe(true); // top 5 bits of 0x07 are zero
    expect(hasLeadingZeroBits(Buffer.from([0x00, 0x0f]), 13)).toBe(false); // 0x0f = 00001111 → 5th bit is 1
  });

  test('a mined nonce verifies against the challenge hash', () => {
    const challenge = 'abc123';
    // mine a 12-bit nonce quickly
    let nonce = 0;
    for (; nonce < 500_000; nonce++) {
      const d = createHash('sha256').update(`${challenge}:${nonce}`).digest();
      if (hasLeadingZeroBits(d, 12)) break;
    }
    const digest = createHash('sha256').update(`${challenge}:${nonce}`).digest();
    expect(hasLeadingZeroBits(digest, 12)).toBe(true);
  });
});

describe('screenshot proof', () => {
  const SHA = 'a'.repeat(64);

  test('image identification uses magic bytes, never the client content-type', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
    expect(detectImage(png)).toBe('png');
    expect(detectImage(jpg)).toBe('jpg');
    expect(detectImage(gif)).toBe('gif');
    expect(detectImage(webp)).toBe('webp');
    // an EXE renamed to .png, a truncated buffer, and nothing at all
    expect(detectImage(Buffer.from('MZ\x90\x00 this is not an image at all'))).toBeNull();
    expect(detectImage(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(detectImage(undefined)).toBeNull();
    expect(MAX_PROOF_BYTES).toBe(4 * 1024 * 1024);
  });

  test('only our own content-addressed upload URLs are accepted as screenshots', () => {
    expect(screenshotOf({ screenshot: `/uploads/proofs/${SHA}.png` })).toBe(`/uploads/proofs/${SHA}.png`);
    expect(screenshotOf({ screenshot: `/uploads/proofs/${SHA}.jpg` })).not.toBeNull();
    // traversal, foreign hosts, wrong prefixes, junk
    expect(screenshotOf({ screenshot: '/uploads/proofs/../../etc/passwd' })).toBeNull();
    expect(screenshotOf({ screenshot: '/uploads/proofs/' + 'b'.repeat(300) + '.png' })).toBeNull();
    expect(screenshotOf({ screenshot: 'https://evil.example/x.png' })).toBeNull();
    expect(screenshotOf({ screenshot: 42 })).toBeNull();
    expect(screenshotOf({})).toBeNull();
  });

  test('a screenshot satisfies {"proof":"screenshot"} and replaces text rules', () => {
    const rules = { proof: 'screenshot' };
    const shot = { screenshot: `/uploads/proofs/${SHA}.png`, fileName: 'shot.png' };
    expect(structuralFailure(rules, shot)).toBeNull();
    expect(structuralFailure(rules, { answer: 'hello' })).toBe('screenshot proof required');
    // a bogus screenshot reference must never auto-approve
    expect(structuralFailure(rules, { screenshot: 'nope.png' })).toBe('invalid screenshot reference');
    expect(structuralFailure(null, { screenshot: 'nope.png' })).toBe('invalid screenshot reference');
    // image evidence short-circuits legacy requiredFields/minChars checks
    expect(structuralFailure({ requiredFields: ['q1'], minChars: 40 }, shot)).toBeNull();
  });

  test('legacy text rules still gate text-only payloads', () => {
    const rules = { requiredFields: ['q1', 'q2'], minChars: 40 };
    expect(structuralFailure(rules, { q1: 'done it' })).toBe('missing required field: q2');
    expect(structuralFailure(rules, { q1: 'short', q2: 'tiny' })).toBe('insufficient detail in proof');
    expect(structuralFailure(rules, { q1: 'a'.repeat(25), q2: 'b'.repeat(25) })).toBeNull();
    expect(structuralFailure({}, { anything: 'goes' })).toBeNull();
  });
});
