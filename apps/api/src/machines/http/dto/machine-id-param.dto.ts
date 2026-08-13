import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

const PUBLIC_MACHINE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export class MachineIdParamDto {
    @ApiProperty({
        description: 'Immutable opaque public machine identifier',
        pattern: PUBLIC_MACHINE_ID_PATTERN.source,
        type: String,
    })
    @IsString()
    @Matches(PUBLIC_MACHINE_ID_PATTERN)
    machineId!: string;
}
