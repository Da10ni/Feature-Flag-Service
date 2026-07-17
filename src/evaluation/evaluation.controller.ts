import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { EvaluateDto } from './dto/evaluate.dto';

@Controller('evaluate')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async evaluate(@Body() dto: EvaluateDto) {
    const result = await this.evaluationService.evaluate(
      { tenantId: dto.tenantId, environment: dto.environment, userId: dto.userId, context: dto.context },
      dto.flagKey!,
    );
    return result;
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  async evaluateBulk(@Body() dto: EvaluateDto) {
    const results = await this.evaluationService.evaluateBulk(
      { tenantId: dto.tenantId, environment: dto.environment, userId: dto.userId, context: dto.context },
    );
    return { flags: results, count: results.length };
  }
}
