import { Global, Module } from '@nestjs/common';

import { AuthMetrics } from './auth-metrics';
import { InternalMetricsGuard } from './internal-metrics.guard';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
    controllers: [MetricsController],
    providers: [AuthMetrics, InternalMetricsGuard],
    exports: [AuthMetrics],
})
export class ObservabilityModule {}
