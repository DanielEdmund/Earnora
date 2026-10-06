import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { SupportService } from './support.service';

export class SupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;
}

export class SupportReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reply!: string;
}

/**
 * User side of the support inbox. Any signed-in user may post an escalation
 * and read back their own thread; the admin side lives in AdminController.
 */
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('messages')
  create(@Req() req: any, @Body() dto: SupportMessageDto) {
    return this.support.create(req.user.sub, dto.message);
  }

  @Get('messages')
  mine(@Req() req: any) {
    return this.support.listForUser(req.user.sub);
  }
}
