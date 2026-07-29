import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { AuthMetrics } from './auth-metrics';
import { InternalMetricsGuard } from './internal-metrics.guard';

@ApiExcludeController()
@Controller('internal/metrics')
@UseGuards(InternalMetricsGuard)
export class MetricsController {
  constructor(@Inject(AuthMetrics) private readonly metrics: AuthMetrics) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): Promise<string> {
    return this.metrics.render();
  }
}
