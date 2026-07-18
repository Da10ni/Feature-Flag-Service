import { LoggerService } from '@nestjs/common';
import { getCorrelationId } from './request-context';

export class JsonLogger implements LoggerService {
  private write(level: string, message: string, context?: string) {
    process.stdout.write(
      JSON.stringify({
        level,
        message,
        context,
        correlationId: getCorrelationId(),
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
  verbose(message: string, context?: string) {
    this.write('verbose', message, context);
  }
  debug(message: string, context?: string) {
    this.write('debug', message, context);
  }
  log(message: string, context?: string) {
    this.write('info', message, context);
  }
  warn(message: string, context?: string) {
    this.write('warn', message, context);
  }
  error(message: string, trace?: string, context?: string) {
    this.write('error', `${message} ${trace || ''}`, context);
  }
}
