import { AsyncLocalStorage } from 'async_hooks';

// Request-scoped store so any log line can pick up the correlation ID without
// threading it through every function call. Node stdlib — no dependency.
export const requestContext = new AsyncLocalStorage<{
  correlationId: string;
}>();

export function getCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}
