import { Global, Module } from '@nestjs/common';

import { RedisScriptRunner } from './redis-script-runner';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, RedisScriptRunner],
  exports: [RedisService, RedisScriptRunner],
})
export class RedisModule {}
