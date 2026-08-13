import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

const MACHINE_REVISION_PATTERN = /^[1-9][0-9]*$/;

export class RevalidateMachineSelectionDto {
    @ApiProperty({
        description: 'Opaque selection revision from the latest machine detail',
        pattern: MACHINE_REVISION_PATTERN.source,
        type: String,
    })
    @IsString()
    @Matches(MACHINE_REVISION_PATTERN)
    expectedMachineRevision!: string;
}
