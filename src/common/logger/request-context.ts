import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage<{
  correlationId: string;
}>();

export function getCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}
