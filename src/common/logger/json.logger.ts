import { LoggerService } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  private log(level: string, message: string, context?: string, correlationId?: string) {
    process.stdout.write(JSON.stringify({ level, message, context, correlationId, timestamp: new Date().toISOString() }) + '\n');
  }
  verbose(message: string, context?: string) { this.log('verbose', message, context); }
  debug(message: string, context?: string) { this.log('debug', message, context); }
  log(message: string, context?: string) { this.log('info', message, context); }
  warn(message: string, context?: string) { this.log('warn', message, context); }
  error(message: string, trace?: string, context?: string) { this.log('error', `${message} ${trace || ''}`, context); }
}
