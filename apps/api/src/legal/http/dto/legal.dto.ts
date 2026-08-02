import { ApiProperty } from '@nestjs/swagger';
import { LegalDocumentKind } from '@prisma/client';

export class LegalDocumentDto {
    @ApiProperty({ format: 'uuid' })
    id!: string;

    @ApiProperty({ enum: LegalDocumentKind })
    kind!: LegalDocumentKind;

    @ApiProperty()
    version!: string;

    @ApiProperty()
    title!: string;

    @ApiProperty()
    content!: string;

    @ApiProperty()
    mandatory!: boolean;

    @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
    contentSha256!: string;
}

export class CurrentLegalSetDto {
    @ApiProperty()
    setVersion!: string;

    @ApiProperty({ type: [LegalDocumentDto] })
    documents!: LegalDocumentDto[];
}
