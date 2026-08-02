import { Module } from '@nestjs/common';

import { LegalService } from './application/legal.service';
import { LegalRepository } from './infrastructure/postgres/legal.repository';

@Module({
    providers: [LegalRepository, LegalService],
    exports: [LegalRepository, LegalService],
})
export class LegalModule {}
