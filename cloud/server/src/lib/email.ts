import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from './logger.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transport: Transporter | null | undefined;

/** Test seam: inject a fake transporter (or null to force the log fallback). */
export function __setTransportForTests(fake: Transporter | null): void {
  transport = fake;
}

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  return transport;
}

/**
 * Send an email via the configured SMTP transport. When SMTP is NOT configured
 * this does NOT throw: it logs a warning plus the full message (including any
 * links) at info level, so an operator can retrieve it from the logs and dev
 * still works without a mail server.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const t = getTransport();
  if (!t) {
    logger.warn(
      { to: mail.to, subject: mail.subject },
      'SMTP not configured (SMTP_URL unset) — logging email instead of sending',
    );
    logger.info(
      { to: mail.to, subject: mail.subject, body: mail.text },
      'Outbound email (not sent)',
    );
    return;
  }
  await t.sendMail({
    from: config.EMAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}
