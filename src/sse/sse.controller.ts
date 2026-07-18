import { Controller, Query, Sse, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';

interface FlagChangedEvent {
  tenantId: string;
  environment?: string;
  flagKey: string;
  action: string;
  flag?: any;
}

@Controller('sse')
@UseGuards(ApiKeyGuard)
export class SseController {
  private events$ = new Subject<FlagChangedEvent>();

  @OnEvent('flag.changed')
  handleFlagChanged(event: FlagChangedEvent) {
    this.events$.next(event);
  }

  // Subscribers only ever see their own tenant's stream — scoped by the authenticated
  // API key, not a query param.
  @Sse('flags')
  streamFlagChanges(
    @CurrentTenant() tenant: Tenant,
    @Query('environment') environment?: string,
  ): Observable<MessageEvent> {
    return this.events$.pipe(
      filter(
        (e) =>
          e.tenantId === tenant.id &&
          (!environment || e.environment === environment),
      ),
      map((e) => ({ data: JSON.stringify(e) }) as MessageEvent),
    );
  }
}
