import { Module } from '@nestjs/common';
import { UserController } from './users.controller';
import { Roles } from '../auth/decorators';

@Module({ controllers: [UserController] })
export class UsersModule {}
