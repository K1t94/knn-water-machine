import { LegalDocumentKind, type Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../prisma/prisma.service';
import { LegalRepository } from './legal.repository';

const publication = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: LegalDocumentKind.TERMS_OF_SERVICE,
  version: '2026-07',
  locale: 'fr-SN',
  title: 'Conditions',
  content: 'Immutable terms',
  contentSha256: 'a'.repeat(64),
  mandatory: true,
  publishedAt: new Date('2026-07-01T00:00:00.000Z'),
  effectiveAt: new Date('2026-07-01T00:00:00.000Z'),
};

describe('LegalRepository', () => {
  it('publishes a new immutable version and atomically retires only the old current row', async () => {
    const transaction = {
      legalDocument: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ ...publication, isCurrent: true }),
      },
    };
    const prisma = {
      $transaction: vi.fn((
        work: (client: Prisma.TransactionClient) => unknown,
      ) => work(transaction as unknown as Prisma.TransactionClient)),
    } as unknown as PrismaService;
    const repository = new LegalRepository(prisma);

    await repository.publishCurrent(publication);

    expect(transaction.legalDocument.updateMany).toHaveBeenCalledWith({
      where: {
        kind: publication.kind,
        locale: 'fr-SN',
        isCurrent: true,
      },
      data: {
        isCurrent: false,
        retiredAt: publication.publishedAt,
      },
    });
    expect(transaction.legalDocument.create).toHaveBeenCalledWith({
      data: { ...publication, isCurrent: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('returns an existing immutable version without overwriting content', async () => {
    const existing = { ...publication, isCurrent: true };
    const transaction = {
      legalDocument: {
        findUnique: vi.fn().mockResolvedValue(existing),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn((
        work: (client: Prisma.TransactionClient) => unknown,
      ) => work(transaction as unknown as Prisma.TransactionClient)),
    } as unknown as PrismaService;
    const repository = new LegalRepository(prisma);

    await expect(repository.publishCurrent({
      ...publication,
      content: 'Attempted overwrite',
    })).resolves.toBe(existing);
    expect(transaction.legalDocument.updateMany).not.toHaveBeenCalled();
    expect(transaction.legalDocument.create).not.toHaveBeenCalled();
  });

  it('persists exact acceptances in deterministic order with conflict safety', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const repository = new LegalRepository({} as PrismaService);
    const transaction = {
      legalAcceptance: { createMany },
    } as unknown as Prisma.TransactionClient;

    await repository.createAcceptancesInTransaction(transaction, {
      userId: '00000000-0000-4000-8000-000000000010',
      documentIds: [
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
      ],
      registrationFlowId: '00000000-0000-4000-8000-000000000020',
      acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          legalDocumentId: '00000000-0000-4000-8000-000000000001',
        }),
        expect.objectContaining({
          legalDocumentId: '00000000-0000-4000-8000-000000000002',
        }),
      ],
    }));
  });

  it('filters current mandatory documents by requested locale', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new LegalRepository({
      legalDocument: { findMany },
    } as unknown as PrismaService);

    await repository.currentMandatory('fr-SN');

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        locale: 'fr-SN',
        mandatory: true,
        isCurrent: true,
      }),
    }));
  });
});
