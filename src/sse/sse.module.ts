import { Module } from '@nestjs/common';
import { SseController } from './sse.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({ imports: [TenantsModule], controllers: [SseController] })
export class SseModule {}
