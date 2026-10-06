import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DB, Db } from '../common/db';

export interface SupportRow {
  id: number;
  message: string;
  status: 'open' | 'replied';
  reply: string | null;
  replied_at: string | Date | null;
  created_at: string | Date;
}

export interface SupportInboxRow extends SupportRow {
  email: string;
}

/** One person can only push so many escalations through the bot. */
const RATE_LIMIT = 10;
const RATE_WINDOW = "interval '1 hour'";

/**
 * The chatbot's escalation path: messages it has no answer for land here,
 * the owner answers from the admin dashboard, and the reply is pulled back
 * into the user's chat thread. Everything is plain rows — no queue, no
 * second store, same tables both sides read and write.
 */
@Injectable()
export class SupportService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(userId: string, raw: string): Promise<SupportRow> {
    const message = (raw ?? '').trim();
    if (!message) throw new BadRequestException('Message cannot be empty');
    if (message.length > 1000) throw new BadRequestException('Message is too long (max 1000 characters)');

    const recent = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM support_messages
        WHERE user_id = $1 AND created_at >= now() - ${RATE_WINDOW}`,
      [userId],
    );
    if (recent.rows[0].n >= RATE_LIMIT) {
      throw new BadRequestException(
        'You are sending messages too quickly — please wait a few minutes before trying again.',
      );
    }

    const r = await this.db.query<SupportRow>(
      `INSERT INTO support_messages (user_id, message)
       VALUES ($1, $2)
       RETURNING id, message, status, reply, replied_at, created_at`,
      [userId, message],
    );
    return r.rows[0];
  }

  /** The user's own thread (questions + any answers), oldest first. */
  async listForUser(userId: string): Promise<SupportRow[]> {
    const r = await this.db.query<SupportRow>(
      `SELECT id, message, status, reply, replied_at, created_at
         FROM support_messages
        WHERE user_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT 200`,
      [userId],
    );
    return r.rows;
  }

  /** Admin inbox: unanswered first, then newest. Email rides along. */
  async adminList(filter: 'all' | 'open' | 'replied'): Promise<SupportInboxRow[]> {
    const r = await this.db.query<SupportInboxRow>(
      `SELECT s.id, s.message, s.status, s.reply, s.replied_at, s.created_at, u.email
         FROM support_messages s
         JOIN users u ON u.id = s.user_id
        WHERE $1 = 'all' OR s.status = $1
        ORDER BY (s.status = 'open') DESC, s.created_at DESC
        LIMIT 200`,
      [filter],
    );
    return r.rows;
  }

  /** Answer a message; re-replying simply overwrites the previous answer. */
  async reply(id: number, adminId: string, raw: string): Promise<SupportRow> {
    const reply = (raw ?? '').trim();
    if (!reply) throw new BadRequestException('Reply cannot be empty');
    if (reply.length > 2000) throw new BadRequestException('Reply is too long (max 2000 characters)');

    const r = await this.db.query<SupportRow>(
      `UPDATE support_messages
          SET status = 'replied', reply = $2, replied_at = now(), replied_by = $3
        WHERE id = $1
        RETURNING id, message, status, reply, replied_at, created_at`,
      [id, reply, adminId],
    );
    if (r.rows.length === 0) throw new NotFoundException('Message not found');
    return r.rows[0];
  }
}
