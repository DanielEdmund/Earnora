import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Public } from './decorators';
import { AuthService } from './auth.service';

class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() referralCode?: string;
}

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
}

class ForgotDto {
  @IsEmail() email!: string;
}

class VerifyOtpDto {
  @IsEmail() email!: string;
  @Matches(/^[0-9]{6}$/, { message: 'Code must be 6 digits' }) code!: string;
}

class ResetDto {
  @IsString() @MinLength(10) resetToken!: string;
  @IsString() @MinLength(8) password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: any) {
    return this.auth.register({
      email: dto.email,
      password: dto.password,
      phone: dto.phone,
      referralCode: dto.referralCode,
      fingerprint: req.headers['x-device-fingerprint'],
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login({
      email: dto.email,
      password: dto.password,
      fingerprint: req.headers['x-device-fingerprint'],
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  /** Step 1 — email the user a 6-digit reset code. */
  @Public()
  @Post('forgot')
  @HttpCode(200)
  forgot(@Body() dto: ForgotDto, @Req() req: any) {
    return this.auth.forgotPassword({ email: dto.email, ip: clientIp(req) });
  }

  /** Step 2 — check the code, return a short-lived reset token. */
  @Public()
  @Post('verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp({ email: dto.email, code: dto.code });
  }

  /** Step 3 — set the new password. */
  @Public()
  @Post('reset')
  @HttpCode(200)
  reset(@Body() dto: ResetDto) {
    return this.auth.resetPassword({ resetToken: dto.resetToken, password: dto.password });
  }
}

/** Trusted proxy headers only (gateway sets X-Forwarded-For; never trust the client directly). */
export function clientIp(req: any): string {
  const xff: string | undefined = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
}
