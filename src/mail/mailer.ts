import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config';

export interface MailResult {
  delivered: boolean;
  /** Empty when delivered, otherwise why it did not go out. */
  reason?: string;
}

let transporter: Transporter | null = null;

function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      // local/dev relays (no TLS) are common; real providers negotiate STARTTLS
      ignoreTLS: config.smtp.port === 1025,
      connectionTimeout: 10_000,
    });
  }
  return transporter;
}

/**
 * Send a plain mail. Never throws: a mail failure must not break the auth flow
 * (the endpoint still answers the same way for every address).
 */
export async function sendMail(opts: { to: string; subject: string; text: string; html: string }): Promise<MailResult> {
  if (!config.smtp.host) return { delivered: false, reason: 'SMTP_HOST not set' };

  try {
    await getTransport().sendMail({ from: config.smtp.from, ...opts });
    return { delivered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mail] send failed: ${message}`);
    return { delivered: false, reason: message };
  }
}

/** Body of the password-reset OTP mail. */
export function otpMail(code: string, expiresInSec: number): { subject: string; text: string; html: string } {
  const mins = Math.round(expiresInSec / 60);
  const subject = 'Your Earnora password reset code';
  const text = [
    `Your Earnora password reset code is: ${code}`,
    '',
    `It expires in ${mins} minutes. If you did not request this, you can ignore this email.`,
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f2f7ff;padding:32px 16px;color:#0b2a4a">
      <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #dbe7ff">
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#3b82f6">Earnora</p>
        <h1 style="margin:0 0 16px;font-size:20px">Password reset code</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Enter this code to choose a new password. It expires in ${mins} minutes.</p>
        <p style="margin:0 0 20px;font-size:34px;letter-spacing:.32em;font-weight:800;background:#eef5ff;border:1px dashed #9dc0ff;border-radius:12px;padding:16px;text-align:center">${code}</p>
        <p style="margin:0;font-size:13px;color:#5b7aa6">If you did not request this, you can safely ignore this email.</p>
      </div>
    </div>`.trim();
  return { subject, text, html };
}
