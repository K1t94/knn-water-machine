import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { LegalRepository, type LegalDocumentView } from '../infrastructure/postgres/legal.repository';

export interface CurrentLegalSet {
    setVersion: string;
    documents: LegalDocumentView[];
}

export class LegalVersionStaleError extends Error {
    readonly code = 'LEGAL_VERSION_STALE';

    constructor() {
        super('The mandatory legal document set changed');
    }
}

@Injectable()
export class LegalService {
    constructor(
        @Inject(LegalRepository)
        private readonly repository: Pick<LegalRepository, 'currentMandatory'>,
    ) {}

    async currentMandatory(locale: string): Promise<CurrentLegalSet> {
        const documents = sortDocuments(await this.repository.currentMandatory(locale));
        return {
            documents,
            setVersion: calculateSetVersion(documents),
        };
    }

    async assertCurrentSet(
        setVersion: string,
        acceptedDocumentIds: readonly string[],
        locale: string,
    ): Promise<LegalDocumentView[]> {
        const current = await this.currentMandatory(locale);
        return this.assertDocumentSet(current.documents, setVersion, acceptedDocumentIds);
    }

    assertDocumentSet(
        documents: readonly LegalDocumentView[],
        setVersion: string,
        acceptedDocumentIds: readonly string[],
    ): LegalDocumentView[] {
        const sortedDocuments = sortDocuments(documents);
        const currentSetVersion = calculateSetVersion(sortedDocuments);
        const expectedIds = sortedDocuments.map(({ id }) => id).sort();
        const receivedIds = [...new Set(acceptedDocumentIds)].sort();
        if (
            currentSetVersion !== setVersion ||
            expectedIds.length === 0 ||
            expectedIds.length !== receivedIds.length ||
            expectedIds.some((id, index) => id !== receivedIds[index])
        ) {
            throw new LegalVersionStaleError();
        }
        return sortedDocuments;
    }
}

export function calculateSetVersion(documents: readonly LegalDocumentView[]): string {
    const canonical = sortDocuments(documents)
        .map(({ id, kind, version, contentSha256 }) => `${kind}\u0000${id}\u0000${version}\u0000${contentSha256}`)
        .join('\u0001');
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sortDocuments(documents: readonly LegalDocumentView[]): LegalDocumentView[] {
    return [...documents].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
