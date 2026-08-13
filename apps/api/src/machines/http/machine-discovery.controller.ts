import {
    Body,
    Controller,
    Get,
    HttpCode,
    Inject,
    Param,
    Post,
    Query,
    UseFilters,
    UseGuards,
    ValidationPipe,
} from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
    ApiExtraModels,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiProperty,
    ApiPropertyOptional,
    ApiQuery,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
    getSchemaPath,
} from '@nestjs/swagger';

import { AccessSessionGuard } from '../../sessions/http/access-session.guard';
import { DiscoverMachinesService } from '../application/discover-machines.service';
import { GetMachineDetailService } from '../application/get-machine-detail.service';
import { ResolveMachineIdentifierService } from '../application/resolve-machine-identifier.service';
import { parseMachineId } from '../domain/machine-validation';

import { DiscoverMachinesQueryDto, MachineCoordinatesQueryDto } from './dto/discover-machines-query.dto';
import { MachineIdParamDto } from './dto/machine-id-param.dto';
import { ResolveMachineIdentifierDto } from './dto/resolve-machine-identifier.dto';
import { MachineErrorFilter } from './machine-error.filter';
import {
    toMachineCatalogPageResponse,
    toMachineDetailResponse,
    type MachineCatalogPageResponse,
    type MachineDetailResponse,
} from './machine-response.mapper';

import type { CatalogCursor, MachineDiscoveryContext, MachineViewport } from '../domain/machine.types';

const DEFAULT_SERVICE_AREA_CODE = 'DKR-CENTRE';
const MACHINE_STATUSES = ['ONLINE', 'OFFLINE', 'SERVICE'] as const;

export class Coordinates {
    @ApiProperty({ maximum: 90, minimum: -90, type: Number })
    latitude!: number;

    @ApiProperty({ maximum: 180, minimum: -180, type: Number })
    longitude!: number;
}

export class PricePerLiter {
    @ApiProperty({ pattern: '^\\d+\\.\\d{4}$', type: String })
    amountPerLiter!: string;

    @ApiProperty({ example: 'XOF', maxLength: 3, minLength: 3, type: String })
    currency!: string;
}

export class MachineSummary {
    @ApiProperty({ minLength: 22, type: String })
    machineId!: string;

    @ApiProperty({ maxLength: 120, minLength: 1, type: String })
    displayName!: string;

    @ApiProperty({ maxLength: 300, minLength: 1, type: String })
    address!: string;

    @ApiPropertyOptional({ type: () => Coordinates })
    coordinates?: Coordinates;

    @ApiPropertyOptional({ minimum: 0, type: Number })
    distanceMeters?: number;

    @ApiPropertyOptional({ type: () => PricePerLiter })
    price?: PricePerLiter;

    @ApiProperty({ enum: MACHINE_STATUSES })
    status!: (typeof MACHINE_STATUSES)[number];

    @ApiProperty({ pattern: '^[1-9][0-9]*$', type: String })
    machineRevision!: string;
}

export class MachineDetail extends MachineSummary {
    @ApiProperty({ type: Boolean })
    selectable!: boolean;

    @ApiProperty({ format: 'date-time', type: String })
    refreshedAt!: string;
}

export class MachineCatalogPage {
    @ApiProperty({ isArray: true, maxItems: 100, type: () => MachineSummary })
    items!: MachineSummary[];

    @ApiPropertyOptional({ type: String })
    nextCursor?: string;

    @ApiProperty({ type: Boolean })
    hasMore!: boolean;

    @ApiProperty({ pattern: '^[1-9][0-9]*$', type: String })
    catalogRevision!: string;
}

export class Problem {
    @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]+$', type: String })
    code!: string;

    @ApiProperty({ type: String })
    message!: string;

    @ApiProperty({ type: Boolean })
    retryable!: boolean;

    @ApiProperty({ format: 'uuid', type: String })
    correlationId!: string;
}

class ValidationField {
    @ApiProperty({ type: String })
    field!: string;

    @ApiProperty({ type: String })
    code!: string;
}

export class ValidationProblem extends Problem {
    @ApiProperty({ enum: ['VALIDATION_ERROR'] })
    declare code: 'VALIDATION_ERROR';

    @ApiProperty({ enum: [false] })
    declare retryable: false;

    @ApiPropertyOptional({ isArray: true, maxItems: 20, type: () => ValidationField })
    fields?: ValidationField[];
}

const problemContent = (model: typeof Problem | typeof ValidationProblem) => ({
    'application/problem+json': { schema: { $ref: getSchemaPath(model) } },
});

@ApiTags('machines')
@ApiBearerAuth('AccessBearer')
@ApiExtraModels(
    Coordinates,
    PricePerLiter,
    MachineSummary,
    MachineDetail,
    MachineCatalogPage,
    Problem,
    ValidationProblem,
)
@UseGuards(AccessSessionGuard)
@UseFilters(MachineErrorFilter)
@Controller('v1/machines')
export class MachineDiscoveryController {
    constructor(
        @Inject(DiscoverMachinesService) private readonly discovery: DiscoverMachinesService,
        @Inject(GetMachineDetailService) private readonly detail: GetMachineDetailService,
        @Inject(ResolveMachineIdentifierService) private readonly identifierResolver: ResolveMachineIdentifierService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'List public water machines' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'cursor', required: false, type: String })
    @ApiQuery({ name: 'latitude', required: false, type: Number })
    @ApiQuery({ name: 'longitude', required: false, type: Number })
    @ApiQuery({ name: 'north', required: false, type: Number })
    @ApiQuery({ name: 'east', required: false, type: Number })
    @ApiQuery({ name: 'south', required: false, type: Number })
    @ApiQuery({ name: 'west', required: false, type: Number })
    @ApiOkResponse({ description: 'Public machine catalog page', type: MachineCatalogPage })
    @ApiBadRequestResponse({ content: problemContent(ValidationProblem), description: 'Invalid discovery query' })
    @ApiUnauthorizedResponse({ content: problemContent(Problem), description: 'Authentication is required' })
    @ApiConflictResponse({ content: problemContent(Problem), description: 'Discovery context changed' })
    @ApiServiceUnavailableResponse({
        content: problemContent(Problem),
        description: 'Machine discovery is temporarily unavailable',
    })
    async discover(
        @Query(new ValidationPipe(dtoValidation(DiscoverMachinesQueryDto))) query: DiscoverMachinesQueryDto,
    ): Promise<MachineCatalogPageResponse> {
        const page = await this.discovery.execute({
            context: discoveryContext(query),
            limit: query.limit,
            cursor: (query.cursor as CatalogCursor | undefined) ?? null,
        });

        return toMachineCatalogPageResponse(page);
    }

    @Post('resolve')
    @HttpCode(200)
    @ApiOperation({ summary: 'Resolve a QR payload or manual machine code' })
    @ApiBody({
        required: true,
        schema: {
            discriminator: { propertyName: 'source' },
            oneOf: [
                {
                    additionalProperties: false,
                    properties: {
                        source: { enum: ['QR'], type: 'string' },
                        value: { maxLength: 2048, minLength: 1, type: 'string' },
                    },
                    required: ['source', 'value'],
                    type: 'object',
                },
                {
                    additionalProperties: false,
                    properties: {
                        source: { enum: ['MANUAL'], type: 'string' },
                        value: { maxLength: 256, minLength: 1, type: 'string' },
                    },
                    required: ['source', 'value'],
                    type: 'object',
                },
            ],
        },
    })
    @ApiOkResponse({ description: 'Fresh public machine details', type: MachineDetail })
    @ApiBadRequestResponse({
        content: problemContent(Problem),
        description: 'Invalid or unsupported machine identifier',
    })
    @ApiUnauthorizedResponse({ content: problemContent(Problem), description: 'Authentication is required' })
    @ApiNotFoundResponse({ content: problemContent(Problem), description: 'Machine not found' })
    @ApiServiceUnavailableResponse({
        content: problemContent(Problem),
        description: 'Machine details are temporarily unavailable',
    })
    async resolve(
        @Body(new ValidationPipe(dtoValidation(ResolveMachineIdentifierDto))) request: ResolveMachineIdentifierDto,
    ): Promise<MachineDetailResponse> {
        const machine = await this.identifierResolver.execute(request);

        return toMachineDetailResponse(machine);
    }

    @Get(':machineId')
    @ApiOperation({ summary: 'Get fresh public water machine details' })
    @ApiParam({ name: 'machineId', description: 'Immutable opaque public machine identifier', type: String })
    @ApiQuery({ name: 'latitude', required: false, type: Number })
    @ApiQuery({ name: 'longitude', required: false, type: Number })
    @ApiOkResponse({ description: 'Fresh public machine details', type: MachineDetail })
    @ApiBadRequestResponse({
        content: problemContent(ValidationProblem),
        description: 'Invalid machine identifier or coordinates',
    })
    @ApiUnauthorizedResponse({ content: problemContent(Problem), description: 'Authentication is required' })
    @ApiNotFoundResponse({ content: problemContent(Problem), description: 'Machine not found' })
    @ApiServiceUnavailableResponse({
        content: problemContent(Problem),
        description: 'Machine details are temporarily unavailable',
    })
    async getDetail(
        @Param(new ValidationPipe(dtoValidation(MachineIdParamDto))) params: MachineIdParamDto,
        @Query(new ValidationPipe(dtoValidation(MachineCoordinatesQueryDto))) coordinates: MachineCoordinatesQueryDto,
    ): Promise<MachineDetailResponse> {
        void coordinates;
        const machine = await this.detail.execute(parseMachineId(params.machineId));

        return toMachineDetailResponse(machine);
    }
}

function dtoValidation(expectedType: new () => object) {
    return {
        expectedType,
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
    } as const;
}

function discoveryContext(query: DiscoverMachinesQueryDto): MachineDiscoveryContext {
    const viewport = queryViewport(query);
    if (query.latitude !== undefined && query.longitude !== undefined) {
        return {
            mode: 'USER_LOCATION',
            position: { latitude: query.latitude, longitude: query.longitude },
            viewport,
        };
    }
    return { mode: 'SERVICE_AREA', serviceAreaCode: DEFAULT_SERVICE_AREA_CODE, viewport };
}

function queryViewport(query: DiscoverMachinesQueryDto): MachineViewport | null {
    if (
        query.north === undefined ||
        query.east === undefined ||
        query.south === undefined ||
        query.west === undefined
    ) {
        return null;
    }
    return { north: query.north, east: query.east, south: query.south, west: query.west };
}
