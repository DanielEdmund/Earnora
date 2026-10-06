import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Public, Roles } from '../auth/decorators';
import { clientIp } from '../auth/auth.controller';
import { DB, Db } from '../common/db';
import { MAX_PLAN_REWARD_KOBO } from '../plans/plans';
import { MAX_PROOF_BYTES } from './proof';
import { TasksService } from './tasks.service';
class CreateTaskDto {
  @IsString() @MinLength(3) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() category!: string; // survey | ad_click | text_validation | app_test
  @IsInt() @Min(1) rewardKobo!: number;
  @IsInt() @Min(1) budgetKobo!: number;
  @IsInt() @Min(1) quota!: number;
  @IsOptional() @IsBoolean() requiresAdmin?: boolean;
  @IsOptional() @IsObject() validationRules?: Record<string, unknown>;
  @IsOptional() @IsString() link?: string; // URL users must open/follow (social tasks, ads, referrals)
}

class SubmitDto {
  @IsObject() payload!: Record<string, unknown>;
}

class RejectDto {
  @IsString() reason!: string;
}

@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    @Inject(DB) private readonly db: Db,
  ) {}

  // ── worker endpoints ──────────────────────────────────────────────────────

  @Get('tasks')
  list(@Req() req: any, @Query('category') category?: string) {
    return this.tasks.listAvailable(req.user.sub, category);
  }

  @Get('tasks/mine')
  mine(@Req() req: any) {
    return this.tasks.myClaims(req.user.sub);
  }

  @Public()
  @Get('tasks/challenge')
  @HttpCode(200)
  challenge(@Req() req: any) {
    const userId = req.user?.sub ?? req.headers['x-anon-id'] ?? clientIp(req);
    return this.tasks.issueChallenge(String(userId));
  }

  @Post('tasks/:id/claim')
  claim(@Param('id') id: string, @Req() req: any, @Headers('x-pow-challenge') challenge?: string, @Headers('x-pow-nonce') nonce?: string) {
    return this.tasks.claim(req.user.sub, id, { challenge, nonce });
  }

  @Post('tasks/:id/submit')
  @HttpCode(200)
  submit(@Param('id') id: string, @Body() dto: SubmitDto, @Req() req: any) {
    return this.tasks.submit(req.user.sub, id, dto.payload);
  }

  /**
   * Screenshot upload for an active claim - the file replaces the old q1/q2
   * write-ups. Multipart, image-only, 8 MB cap; stored content-addressed under
   * uploads/proofs and served statically at /uploads/proofs/<sha256>.<ext>.
   */
  @Post('tasks/:id/proof')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PROOF_BYTES },
      fileFilter: (_req, file, cb) => cb(null, !!file.mimetype && file.mimetype.startsWith('image/')),
    }),
  )
  uploadProof(
    @Param('id') id: string,
    @Req() req: any,
    @UploadedFile() file?: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer },
  ) {
    return this.tasks.saveProof(req.user.sub, id, file);
  }

  // ── admin ─────────────────────────────────────────────────────────────────

  @Roles('admin')
  @Post('admin/tasks')
  async createTask(@Body() dto: CreateTaskDto, @Req() req: any) {
    if (dto.budgetKobo < dto.rewardKobo * dto.quota) {
      throw new BadRequestException('Budget must cover reward × quota');
    }
    if (dto.budgetKobo < MAX_PLAN_REWARD_KOBO * dto.quota) {
      throw new BadRequestException(
        `Budget must cover at least ₦${MAX_PLAN_REWARD_KOBO / 100} × quota — that is the highest plan payout per approval`,
      );
    }
    const rawLink = (dto.link ?? '').trim();
    const link = rawLink ? (/^https?:\/\//i.test(rawLink) ? rawLink : `https://${rawLink}`) : null;
    const r = await this.db.query(
      `INSERT INTO tasks (advertiser_id, title, description, category, reward_kobo, budget_kobo, quota,
                          requires_admin, validation_rules, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING *`,
      [
        req.user.sub,
        dto.title,
        dto.description ?? '',
        dto.category,
        dto.rewardKobo,
        dto.budgetKobo,
        dto.quota,
        dto.requiresAdmin ?? false,
        JSON.stringify(dto.validationRules ?? {}),
        link,
      ],
    );
    return r.rows[0];
  }

  @Roles('admin')
  @Get('admin/submissions')
  async submissions(@Query('status') status = 'queued_review') {
    const r = await this.db.query(
      `SELECT c.id, c.task_id, c.user_id, c.status, c.claimed_at, c.submitted_at,
              c.proof_payload, c.proof_hash, c.rejection_reason, c.reward_kobo,
              t.title, t.category, u.email, u.trust_score
         FROM task_claims c
         JOIN tasks t ON t.id = c.task_id
         JOIN users u ON u.id = c.user_id
        WHERE c.status = $1
        ORDER BY c.submitted_at ASC
        LIMIT 100`,
      [status],
    );
    return r.rows;
  }

  @Roles('admin')
  @Post('admin/submissions/:id/approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.tasks.approveSubmission(Number(id), req.user.sub).then((applied) => ({ applied }));
  }

  @Roles('admin')
  @Post('admin/submissions/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto, @Req() req: any) {
    return this.tasks.rejectSubmission(Number(id), dto.reason || 'Rejected by reviewer', req.user.sub).then(
      (applied) => ({ applied }),
    );
  }

  @Roles('admin')
  @Get('admin/tasks/:id')
  async taskDetail(@Param('id') id: string) {
    const r = await this.db.query(
      `SELECT t.*, u.email AS advertiser_email FROM tasks t LEFT JOIN users u ON u.id = t.advertiser_id WHERE t.id = $1`,
      [id],
    );
    if (r.rows.length === 0) throw new NotFoundException('Task not found');
    const claims = await this.db.query(
      `SELECT id, user_id, status, claimed_at, submitted_at, reward_kobo FROM task_claims
        WHERE task_id = $1 ORDER BY claimed_at DESC LIMIT 200`,
      [id],
    );
    return { task: r.rows[0], claims: claims.rows };
  }

  @Roles('admin')
  @Delete('admin/tasks/:id')
  async closeTask(@Param('id') id: string) {
    const r = await this.db.query(`UPDATE tasks SET status = 'closed' WHERE id = $1 RETURNING id`, [id]);
    if (r.rows.length === 0) throw new NotFoundException('Task not found');
    return { closed: true };
  }
}
