import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Public } from '../auth/decorators';
import { config } from '../config';
import { PLAN_KEYS, PlanKey } from '../plans/plans';
import { PaymentsService } from './payments.service';

class InitializeDto {
  @IsIn(PLAN_KEYS as [PlanKey, ...PlanKey[]])
  planKey!: PlanKey;
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** POST /payments/initialize — begin the one-time plan checkout. */
  @Post('payments/initialize')
  @HttpCode(200)
  initialize(@Body() dto: InitializeDto, @Req() req: any) {
    return this.payments.initialize(req.user.sub, dto.planKey);
  }

  @Get('payments/:reference')
  async status(@Param('reference') reference: string, @Req() req: any) {
    const p = await this.payments.getPayment(reference);
    // owner of the payment (or an admin) — otherwise pretend it doesn't exist
    if (!p || (req.user.role !== 'admin' && p.user_id !== req.user.sub)) throw new NotFoundException('Payment not found');
    return p;
  }

  /** The caller's newest payment that still needs the owner's approve/reject (or was rejected). */
  @Get('payments/mine/pending')
  async minePending(@Req() req: any) {
    return this.payments.getUsersPendingDecision(req.user.sub);
  }

  /**
   * PSP callback endpoint. Public by design — authenticated by HMAC signature.
   * rawBody is preserved by NestFactory({ rawBody: true }) so the HMAC covers
   * the exact bytes the PSP sent (never a re-serialized object).
   * Disabled in manual mode (PSP_MODE=simulated): there is no PSP to call us
   * back, so the route stays shut instead of being a forgery surface.
   */
  @Public()
  @Post('webhooks/paystack')
  @HttpCode(200)
  webhook(@Req() req: any, @Headers('x-paystack-signature') signature?: string) {
    if (config.psp.mode === 'simulated') throw new NotFoundException('Webhooks are disabled (PSP_MODE=simulated)');
    const raw: Buffer | undefined = req.rawBody;
    if (!raw) throw new BadRequestException('Raw body unavailable for signature verification');
    return this.payments.handleWebhook(raw, signature);
  }
}
