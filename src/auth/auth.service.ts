import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { AuthUser } from './auth.guard';
import { config } from '../config';
import { CacheService } from '../common/cache';
import { DB, Db, isUniqueViolation } from '../common/db';
import { fraudRegisterAccount, fraudRecordLogin } from '../fraud/fraud';
import { otpMail, sendMail } from '../mail/mailer';

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

/** OTP lifetime — how long a code stays valid once issued. */
const OTP_TTL_SEC = 600;
/** Reset-token lifetime after a successful OTP check. */
const RESET_TTL_SEC = 900;

export interface RegisterInput {
  email: string;
  phone?: string;
  password: string;
  referralCode?: string;
  /** Must be true — the Terms & Policy consent checkbox at registration. */
  termsConsent?: boolean;
  fingerprint?: string;
  ip: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt, 64);
    return `scrypt:${salt}:${hash.toString('hex')}`;
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, salt, hex] = stored.split(':');
    if (scheme !== 'scrypt' || !salt || !hex) return false;
    const hash = await scrypt(password, salt, 64);
    const expected = Buffer.from(hex, 'hex');
    return expected.length === hash.length && timingSafeEqual(hash, expected);
  }

  async register(input: RegisterInput): Promise<{ tokens: TokenPair; userId: string }> {
    const email = input.email.trim().toLowerCase();
    if (!input.password || input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    // Terms & Policy consent is mandatory — "I do not agree" simply means no
    // account can be created (the checkbox is on the register form).
    if (input.termsConsent !== true) {
      throw new BadRequestException('You must agree to the Terms & Policy to create an account');
    }

    // resolve referral code before the transaction (read-only)
    let referredBy: string | null = null;
    if (input.referralCode) {
      const ref = await this.db.query<{ id: string }>(
        `SELECT id FROM users WHERE referral_code = $1 AND status <> 'banned'`,
        [input.referralCode.trim().toUpperCase()],
      );
      if (ref.rows.length === 0) throw new BadRequestException('Invalid referral code');
      referredBy = ref.rows[0].id;
    }

    const passwordHash = await this.hashPassword(input.password);

    try {
      const userId = await this.db.transaction(async (q) => {
        const inserted = await q<{ id: string }>(
          `INSERT INTO users (email, phone, password_hash, referred_by, referral_code, terms_consent_at)
           VALUES ($1, $2, $3, $4, $5, now())
           RETURNING id`,
          [email, input.phone ?? null, passwordHash, referredBy, this.generateReferralCode()],
        );
        const id = inserted.rows[0].id;
        await q(`INSERT INTO wallets (user_id) VALUES ($1)`, [id]);

        // device / IP mesh: throws when the hard multi-account limit is exceeded
        await fraudRegisterAccount(q, {
          userId: id,
          fingerprint: input.fingerprint,
          ip: input.ip,
          userAgent: input.userAgent,
        });
        return id;
      });

      const tokens = await this.issueTokens({ sub: userId, email, role: 'user' });
      return { tokens, userId };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException((err as any).response ?? 'Email or phone already registered');
      }
      throw err;
    }
  }

  async login(input: { email: string; password: string; fingerprint?: string; ip: string; userAgent?: string }) {
    const email = input.email.trim().toLowerCase();
    const found = await this.db.query<{ id: string; password_hash: string; role: string; status: string }>(
      `SELECT id, password_hash, role, status FROM users WHERE lower(email) = $1`,
      [email],
    );
    if (found.rows.length === 0) throw new UnauthorizedException('Invalid credentials');
    const user = found.rows[0];

    const fails = await this.cache.incr(`login_fail:${email}`, 900);
    if (fails > 10) {
      throw new HttpException('Too many failed attempts — try again in 15 minutes', HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await this.verifyPassword(input.password, user.password_hash);
    if (!ok) {
      await this.cache.incr(`login_fail:${email}`, 900);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status === 'banned') throw new UnauthorizedException('Account banned');
    await this.cache.del(`login_fail:${email}`);

    await this.db.transaction((q) => fraudRecordLogin(q, { userId: user.id, ip: input.ip, fingerprint: input.fingerprint, userAgent: input.userAgent }));

    const tokens = await this.issueTokens({ sub: user.id, email, role: user.role });
    return { tokens, userId: user.id, status: user.status };
  }

  async refresh(refreshToken: string) {
    let decoded: { sub?: string; typ?: string };
    try {
      decoded = verify(refreshToken, config.jwtSecret) as { sub?: string; typ?: string };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (decoded.typ !== 'refresh' || !decoded.sub) throw new UnauthorizedException('Invalid refresh token');

    const hash = createHash('sha256').update(refreshToken).digest('hex');
    const found = await this.db.query<{ email: string; role: string }>(
      `SELECT email, role FROM users
        WHERE id = $1 AND refresh_token_hash = $2 AND refresh_expires_at > now()`,
      [decoded.sub, hash],
    );
    if (found.rows.length === 0) throw new UnauthorizedException('Refresh token revoked');

    return this.issueTokens({ sub: decoded.sub, email: found.rows[0].email, role: found.rows[0].role });
  }

  /**
   * Step 1 of password recovery — issue a 6-digit email OTP.
   * The response is identical whether or not the account exists, so an
   * attacker cannot enumerate registered addresses.
   */
  async forgotPassword(input: { email: string; ip: string }): Promise<{ sent: true; expiresInSec: number }> {
    const email = input.email.trim().toLowerCase();

    const sends = await this.cache.incr(`otp_send:${email}`, 900);
    if (sends > 3) {
      throw new HttpException('Too many reset requests — try again in 15 minutes', HttpStatus.TOO_MANY_REQUESTS);
    }
    const ipSends = await this.cache.incr(`otp_send_ip:${input.ip}`, 900);
    if (ipSends > 20) {
      throw new HttpException('Too many reset requests — try again in 15 minutes', HttpStatus.TOO_MANY_REQUESTS);
    }

    const found = await this.db.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
    if (found.rows.length > 0) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      // Store a digest keyed on the email+secret, never the raw code.
      const digest = createHash('sha256').update(`${email}:${code}:${config.jwtSecret}`).digest('hex');
      await this.cache.set(`otp:${email}`, digest, OTP_TTL_SEC);
      await this.cache.del(`otp_try:${email}`);
      // Only expose the code in the log when there is no mail channel at all
      // (local dev). With SMTP configured the code goes to the inbox alone —
      // production logs must never contain password-reset codes.
      if (!config.smtp.host) console.warn(`[auth] password reset code for ${email}: ${code}`);

      // Outbound mail is best-effort and never blocks (or fails) the request:
      // without SMTP_HOST the code above stays the only delivery channel.
      void sendMail({ to: email, ...otpMail(code, OTP_TTL_SEC) }).then((res) => {
        if (res.delivered) console.warn(`[auth] reset code emailed to ${email}`);
        else if (config.smtp.host) console.warn(`[auth] email delivery failed for ${email} (${res.reason})`);
        else console.warn(`[auth] email not sent (${res.reason}) — use the code logged above`);
      });
    }

    return { sent: true, expiresInSec: OTP_TTL_SEC };
  }

  /** Step 2 — check the OTP and hand back a short-lived reset token. */
  async verifyOtp(input: { email: string; code: string }): Promise<{ resetToken: string; expiresInSec: number }> {
    const email = input.email.trim().toLowerCase();

    const tries = await this.cache.incr(`otp_try:${email}`, 900);
    if (tries > 5) {
      throw new HttpException('Too many attempts — try again in 15 minutes', HttpStatus.TOO_MANY_REQUESTS);
    }

    const stored = await this.cache.get(`otp:${email}`);
    if (!stored) throw new BadRequestException('Invalid or expired code');

    const guess = createHash('sha256').update(`${email}:${input.code}:${config.jwtSecret}`).digest('hex');
    const a = Buffer.from(stored, 'utf8');
    const b = Buffer.from(guess, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BadRequestException('Invalid or expired code');

    await this.cache.del(`otp:${email}`);
    await this.cache.del(`otp_try:${email}`);

    const resetToken = randomBytes(32).toString('base64url');
    await this.cache.set(`reset:${resetToken}`, email, RESET_TTL_SEC);
    return { resetToken, expiresInSec: RESET_TTL_SEC };
  }

  /** Step 3 — swap the password, revoke every existing refresh token. */
  async resetPassword(input: { resetToken: string; password: string }): Promise<{ reset: true }> {
    if (!input.password || input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const email = await this.cache.get(`reset:${input.resetToken}`);
    if (!email) throw new BadRequestException('Reset session expired — request a new code');

    const passwordHash = await this.hashPassword(input.password);
    await this.db.query(
      `UPDATE users SET password_hash = $2, refresh_token_hash = NULL, refresh_expires_at = NULL
        WHERE lower(email) = $1`,
      [email, passwordHash],
    );

    await this.cache.del(`reset:${input.resetToken}`);
    await this.cache.del(`login_fail:${email}`);
    await this.cache.del(`otp:${email}`);

    return { reset: true };
  }

  private async issueTokens(user: AuthUser): Promise<TokenPair> {
    const accessToken = sign({ sub: user.sub, email: user.email, role: user.role }, config.jwtSecret, {
      expiresIn: config.accessTokenTtlSec,
    });
    const refreshToken = sign({ sub: user.sub, typ: 'refresh' }, config.jwtSecret, { expiresIn: '30d' });
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    await this.db.query(`UPDATE users SET refresh_token_hash = $2, refresh_expires_at = now() + interval '30 days' WHERE id = $1`, [
      user.sub,
      hash,
    ]);
    return { accessToken, refreshToken, expiresIn: config.accessTokenTtlSec };
  }

  private generateReferralCode(): string {
    return randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'X').slice(0, 8).toUpperCase();
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
