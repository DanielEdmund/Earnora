import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verify } from 'jsonwebtoken';
import { config } from '../config';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

export interface AuthUser {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing bearer token');
    }

    let user: AuthUser & { typ?: string };
    try {
      user = verify(token, config.jwtSecret) as AuthUser & { typ?: string };
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
    // A 30-day refresh token must never work as a 2h access token: both are
    // signed with jwtSecret, so the typ claim is the only thing separating them.
    if (user.typ === 'refresh') {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.user = user;

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
