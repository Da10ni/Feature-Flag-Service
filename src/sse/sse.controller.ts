import { Controller, Get, Query, Sse } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

interface FlagChangedEvent {
  tenantId: string;
  environment?: string;
  flagKey: string;
  action: string;
  flag?: any;
}

@Controller('sse')
export class SseController {
  private events$ = new Subject<FlagChangedEvent>();

  @OnEvent('flag.changed')
  handleFlagChanged(event: FlagChangedEvent) {
    this.events$.next(event);
  }

  @Sse('flags')
  streamFlagChanges(
    @Query('tenantId') tenantId: string,
    @Query('environment') environment?: string,
  ): Observable<MessageEvent> {
    return this.events$.pipe(
      filter(e => e.tenantId === tenantId && (!environment || e.environment === environment)),
      map(e => ({ data: JSON.stringify(e) } as MessageEvent)),
    );
  }
}
