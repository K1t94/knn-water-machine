import { Module } from '@nestjs/common';

import { UsersRepository } from './infrastructure/postgres/users.repository';

@Module({
    providers: [UsersRepository],
    exports: [UsersRepository],
})
export class UsersModule {}
