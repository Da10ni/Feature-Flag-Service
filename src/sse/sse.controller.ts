import { Controller, Query, Sse, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Environment } from '../flags/entities/flag-environment.entity';
import { ErrorResponseDto } from '../common/dto/api-responses.dto';

interface FlagChangedEvent {
  tenantId: string;
  environment?: string;
  flagKey: string;
  action: string;
  flag?: any;
}

@ApiTags('Real-Time')
@ApiSecurity('api-key')
@Controller('sse')
@UseGuards(ApiKeyGuard)
export class SseController {
  private events$ = new Subject<FlagChangedEvent>();

  @OnEvent('flag.changed')
  handleFlagChanged(event: FlagChangedEvent) {
    this.events$.next(event);
  }

  @Sse('flags')
  @ApiOperation({
    summary: 'Subscribe to flag changes (Server-Sent Events)',
    description:
      'Long-lived `text/event-stream` connection. Every flag create, update or archive for the authenticated tenant is pushed to connected subscribers immediately, so clients can react without polling.\n\n' +
      "**Tenant scoping is enforced by the API key, not by a query parameter** — a subscriber can only ever receive its own tenant's events, and there is no parameter that could be tampered with to widen that.\n\n" +
      'Each message is an SSE `data:` frame containing JSON: `{ tenantId, flagKey, action, environment?, flag? }` where `action` is `CREATED`, `UPDATED` or `ARCHIVED`.\n\n' +
      'Note: events are delivered from the in-process emitter of the instance holding the connection. With multiple Cloud Run instances a subscriber receives changes made on its own instance; see "Future Improvements" in the README for the shared pub/sub upgrade.\n\n' +
      'Try-it-out in Swagger UI does not render streaming responses — use `curl -N`.',
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    enum: Environment,
    description:
      'Only receive events for this environment. Omit to receive events for all environments.',
  })
  @ApiOkResponse({
    description: 'An open SSE stream of flag-change events.',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
        example:
          'data: {"tenantId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","flagKey":"new-checkout-flow","action":"UPDATED","environment":"production"}\n\n',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid `x-api-key`.',
    type: ErrorResponseDto,
  })
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
