import { Inject, Injectable } from '@nestjs/common';
import { type Prisma, type User } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

export type UserTransaction = Prisma.TransactionClient;

@Injectable()
export class UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByPhone(phoneE164: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phoneE164 } });
  }

  findByPhoneInTransaction(
    transaction: UserTransaction,
    phoneE164: string,
  ): Promise<User | null> {
    return transaction.user.findUnique({ where: { phoneE164 } });
  }

  createConfirmedInTransaction(
    transaction: UserTransaction,
    input: {
      id: string;
      phoneE164: string;
      phoneConfirmedAt: Date;
    },
  ): Promise<User> {
    return transaction.user.create({ data: input });
  }

  upsertConfirmedInTransaction(
    transaction: UserTransaction,
    input: {
      id: string;
      phoneE164: string;
      phoneConfirmedAt: Date;
    },
  ): Promise<User> {
    return transaction.user.upsert({
      where: { phoneE164: input.phoneE164 },
      create: input,
      update: {},
    });
  }
}
