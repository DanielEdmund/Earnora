import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TasksWorker } from './tasks.worker';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksWorker],
  exports: [TasksService],
})
export class TasksModule {}
