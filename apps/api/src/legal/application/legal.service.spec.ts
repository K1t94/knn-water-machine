import { LegalDocumentKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { LegalVersionStaleError, LegalService } from './legal.service';

const documents = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    kind: LegalDocumentKind.PRIVACY_POLICY,
    version: '2026-07',
    locale: 'fr-SN',
    title: 'Confidentialite',
    content: 'Politique',
    contentSha256: 'b'.repeat(64),
    mandatory: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000001',
    kind: LegalDocumentKind.TERMS_OF_SERVICE,
    version: '2026-07',
    locale: 'fr-SN',
    title: 'Conditions',
    content: 'Conditions',
    contentSha256: 'a'.repeat(64),
    mandatory: true,
  },
];

describe('LegalService', () => {
  const repository = {
    currentMandatory: vi.fn(async () => [...documents].reverse()),
  };
  const service = new LegalService(repository);

  it('returns a deterministic current mandatory set', async () => {
    const result = await service.currentMandatory('fr-SN');

    expect(result.documents.map((document) => document.id)).toEqual(
      [...documents]
        .sort((left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.id.localeCompare(right.id))
        .map(({ id }) => id),
    );
    expect(result.setVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.currentMandatory).toHaveBeenCalledWith('fr-SN');
  });

  it('rejects an incomplete or stale exact set', async () => {
    const current = await service.currentMandatory('fr-SN');

    await expect(service.assertCurrentSet(
      current.setVersion,
      [documents[0]!.id],
      'fr-SN',
    )).rejects.toBeInstanceOf(LegalVersionStaleError);
  });

  it('accepts the exact current set regardless of client ordering', async () => {
    const current = await service.currentMandatory('fr-SN');

    await expect(service.assertCurrentSet(
      current.setVersion,
      documents.map((document) => document.id).reverse(),
      'fr-SN',
    )).resolves.toEqual(current.documents);
  });

  it('treats an immutable content/version change as a new stale set', async () => {
    const current = await service.currentMandatory('fr-SN');
    const changed = documents.map((document, index) => index === 0
      ? {
          ...document,
          version: '2026-08',
          contentSha256: 'c'.repeat(64),
        }
      : document);

    expect(() => service.assertDocumentSet(
      changed,
      current.setVersion,
      current.documents.map(({ id }) => id),
    )).toThrow(LegalVersionStaleError);
    expect(documents[0]).toMatchObject({
      version: '2026-07',
      contentSha256: 'b'.repeat(64),
    });
  });
});
