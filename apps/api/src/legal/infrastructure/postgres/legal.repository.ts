import { Inject, Injectable } from '@nestjs/common';
import { type LegalAcceptance, type LegalDocument, type Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

export type LegalDocumentView = Pick<
    LegalDocument,
    'id' | 'kind' | 'version' | 'locale' | 'title' | 'content' | 'contentSha256' | 'mandatory'
>;

export interface PublishLegalDocumentInput {
    id: string;
    kind: LegalDocument['kind'];
    version: string;
    locale: string;
    title: string;
    content: string;
    contentSha256: string;
    mandatory: boolean;
    publishedAt: Date;
    effectiveAt: Date;
}

@Injectable()
export class LegalRepository {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

    currentMandatory(locale: string): Promise<LegalDocumentView[]> {
        return this.prisma.legalDocument.findMany({
            where: {
                locale,
                mandatory: true,
                isCurrent: true,
                effectiveAt: { lte: new Date() },
            },
            select: {
                id: true,
                kind: true,
                version: true,
                locale: true,
                title: true,
                content: true,
                contentSha256: true,
                mandatory: true,
            },
            orderBy: [{ kind: 'asc' }, { id: 'asc' }],
        });
    }

    currentMandatoryInTransaction(transaction: Prisma.TransactionClient, locale: string): Promise<LegalDocumentView[]> {
        return transaction.legalDocument.findMany({
            where: {
                locale,
                mandatory: true,
                isCurrent: true,
                effectiveAt: { lte: new Date() },
            },
            select: {
                id: true,
                kind: true,
                version: true,
                locale: true,
                title: true,
                content: true,
                contentSha256: true,
                mandatory: true,
            },
            orderBy: [{ kind: 'asc' }, { id: 'asc' }],
        });
    }

    async acceptedDocumentIds(userId: string): Promise<string[]> {
        const rows = await this.prisma.legalAcceptance.findMany({
            where: { userId },
            select: { legalDocumentId: true },
        });
        return rows.map((row) => row.legalDocumentId);
    }

    createAcceptancesInTransaction(
        transaction: Prisma.TransactionClient,
        input: {
            userId: string;
            documentIds: readonly string[];
            registrationFlowId: string;
            acceptedAt: Date;
            ipFingerprint?: string;
            installationFingerprint?: string;
            userAgentFamily?: string;
        },
    ): Promise<Prisma.BatchPayload> {
        return transaction.legalAcceptance.createMany({
            data: [...input.documentIds].sort().map((legalDocumentId) => ({
                userId: input.userId,
                legalDocumentId,
                registrationFlowId: input.registrationFlowId,
                acceptedAt: input.acceptedAt,
                ...(input.ipFingerprint ? { ipFingerprint: input.ipFingerprint } : {}),
                ...(input.installationFingerprint ? { installationFingerprint: input.installationFingerprint } : {}),
                ...(input.userAgentFamily ? { userAgentFamily: input.userAgentFamily } : {}),
            })),
            skipDuplicates: true,
        });
    }

    findAcceptances(userId: string): Promise<LegalAcceptance[]> {
        return this.prisma.legalAcceptance.findMany({ where: { userId } });
    }

    publishCurrent(input: PublishLegalDocumentInput): Promise<LegalDocument> {
        return this.prisma.$transaction(
            async (transaction) => {
                const existing = await transaction.legalDocument.findUnique({
                    where: {
                        kind_version_locale: {
                            kind: input.kind,
                            version: input.version,
                            locale: input.locale,
                        },
                    },
                });
                if (existing) return existing;

                await transaction.legalDocument.updateMany({
                    where: {
                        kind: input.kind,
                        locale: input.locale,
                        isCurrent: true,
                    },
                    data: { isCurrent: false, retiredAt: input.publishedAt },
                });
                return transaction.legalDocument.create({
                    data: { ...input, isCurrent: true },
                });
            },
            { isolationLevel: 'Serializable' },
        );
    }
}
