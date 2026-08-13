import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength, ValidateBy, buildMessage } from 'class-validator';

const RESOLVE_IDENTIFIER_SOURCES = ['QR', 'MANUAL'] as const;
const MAX_QR_VALUE_LENGTH = 2048;
const MAX_MANUAL_VALUE_LENGTH = 256;

type ResolveIdentifierSource = (typeof RESOLVE_IDENTIFIER_SOURCES)[number];

export class ResolveMachineIdentifierDto {
    @ApiProperty({ enum: RESOLVE_IDENTIFIER_SOURCES, type: String })
    @IsIn(RESOLVE_IDENTIFIER_SOURCES)
    source!: ResolveIdentifierSource;

    @ApiProperty({
        description: 'Supported QR payload or manual machine code, bounded according to source',
        minLength: 1,
        maxLength: MAX_QR_VALUE_LENGTH,
        type: String,
    })
    @IsString()
    @MinLength(1)
    @HasValidLengthForSource()
    value!: string;
}

function HasValidLengthForSource(): PropertyDecorator {
    return ValidateBy(
        {
            name: 'hasValidLengthForSource',
            validator: {
                validate(value: unknown, args): boolean {
                    if (args === undefined || typeof value !== 'string') return false;

                    const source = (args.object as Partial<ResolveMachineIdentifierDto>).source;
                    if (source === 'QR') return value.length <= MAX_QR_VALUE_LENGTH;
                    if (source === 'MANUAL') return value.length <= MAX_MANUAL_VALUE_LENGTH;
                    return false;
                },
                defaultMessage: buildMessage(
                    (eachPrefix) =>
                        `${eachPrefix}$property exceeds the maximum length allowed for the selected source`,
                ),
            },
        },
        {},
    );
}
