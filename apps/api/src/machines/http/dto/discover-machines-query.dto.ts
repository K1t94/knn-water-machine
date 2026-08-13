import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsDefined,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateBy,
    ValidateIf,
    buildMessage,
} from 'class-validator';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

type CoordinateQuery = {
    latitude?: number;
    longitude?: number;
};

type ViewportQuery = {
    north?: number;
    east?: number;
    south?: number;
    west?: number;
};

export class MachineCoordinatesQueryDto {
    @ApiPropertyOptional({ minimum: -90, maximum: 90, type: Number })
    @ValidateIf((query: CoordinateQuery) => query.latitude !== undefined || query.longitude !== undefined)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-90)
    @Max(90)
    latitude?: number;

    @ApiPropertyOptional({ minimum: -180, maximum: 180, type: Number })
    @ValidateIf((query: CoordinateQuery) => query.latitude !== undefined || query.longitude !== undefined)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-180)
    @Max(180)
    longitude?: number;
}

export class DiscoverMachinesQueryDto extends MachineCoordinatesQueryDto {
    @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, minimum: 1, maximum: MAX_PAGE_LIMIT, type: Number })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE_LIMIT)
    limit = DEFAULT_PAGE_LIMIT;

    @ApiPropertyOptional({ minLength: 16, maxLength: 2048, type: String })
    @IsOptional()
    @IsString()
    @MinLength(16)
    @MaxLength(2048)
    cursor?: string;

    @ApiPropertyOptional({ minimum: -90, maximum: 90, type: Number })
    @ValidateIf(hasViewport)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-90)
    @Max(90)
    @IsGreaterThan('south')
    north?: number;

    @ApiPropertyOptional({ minimum: -180, maximum: 180, type: Number })
    @ValidateIf(hasViewport)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-180)
    @Max(180)
    @IsGreaterThan('west')
    east?: number;

    @ApiPropertyOptional({ minimum: -90, maximum: 90, type: Number })
    @ValidateIf(hasViewport)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-90)
    @Max(90)
    south?: number;

    @ApiPropertyOptional({ minimum: -180, maximum: 180, type: Number })
    @ValidateIf(hasViewport)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-180)
    @Max(180)
    west?: number;
}

function hasViewport(query: ViewportQuery): boolean {
    return (
        query.north !== undefined || query.east !== undefined || query.south !== undefined || query.west !== undefined
    );
}

function IsGreaterThan(property: keyof ViewportQuery): PropertyDecorator {
    return ValidateBy(
        {
            name: 'isGreaterThan',
            constraints: [property],
            validator: {
                validate(value: unknown, args): boolean {
                    if (args === undefined) return false;
                    const comparedValue = (args.object as ViewportQuery)[property];
                    return typeof value === 'number' && typeof comparedValue === 'number' && value > comparedValue;
                },
                defaultMessage: buildMessage(
                    (eachPrefix, args) =>
                        `${eachPrefix}$property must be greater than ${String(args?.constraints[0] ?? 'the compared value')}`,
                ),
            },
        },
        {},
    );
}
