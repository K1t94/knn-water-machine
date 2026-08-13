import { randomUUID } from 'node:crypto';

import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    Post,
    Req,
    Res,
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
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
    ApiUnprocessableEntityResponse,
    getSchemaPath,
} from '@nestjs/swagger';

import { AccessSessionGuard } from '../../sessions/http/access-session.guard';
import { MachineApplicationError } from '../application/machine-application.error';
import { RevalidateMachineSelectionService } from '../application/revalidate-machine-selection.service';
import { parseMachineId } from '../domain/machine-validation';

import { MachineIdParamDto } from './dto/machine-id-param.dto';
import { RevalidateMachineSelectionDto } from './dto/revalidate-machine-selection.dto';
import { MachineDetail, Problem, PricePerLiter, ValidationProblem } from './machine-discovery.controller';
import { MachineErrorFilter } from './machine-error.filter';
import {
    toMachineContextChangedResponse,
    type MachineContextChangedResponse,
    type MachineResponseProjection,
} from './machine-response.mapper';

import type { AuthSecurityRequest } from '../../auth/http/auth-request-context.middleware';
import type {
    MachineRevision,
    MachineSelectionHandoff as MachineSelectionHandoffProjection,
} from '../domain/machine.types';
import type { Request, Response } from 'express';

type MachineSelectionHandoffResponse = Pick<
    MachineSelectionHandoffProjection,
    'machineId' | 'machineRevision' | 'price' | 'availability' | 'validatedAt'
>;

type MachineContextChangedError = MachineApplicationError & {
    readonly currentMachine: MachineResponseProjection;
};

export class MachineSelectionHandoff {
    @ApiProperty({ minLength: 22, type: String })
    machineId!: string;

    @ApiProperty({ pattern: '^[1-9][0-9]*$', type: String })
    machineRevision!: string;

    @ApiProperty({ type: () => PricePerLiter })
    price!: PricePerLiter;

    @ApiProperty({ enum: ['ONLINE'] })
    availability!: 'ONLINE';

    @ApiProperty({ format: 'date-time', type: String })
    validatedAt!: string;
}

export class MachineContextChangedProblem extends Problem {
    @ApiProperty({ enum: ['MACHINE_CONTEXT_CHANGED'] })
    declare code: 'MACHINE_CONTEXT_CHANGED';

    @ApiProperty({ enum: [false] })
    declare retryable: false;

    @ApiProperty({ type: () => MachineDetail })
    currentMachine!: MachineDetail;
}

const problemContent = (model: typeof Problem | typeof ValidationProblem | typeof MachineContextChangedProblem) => ({
    'application/problem+json': { schema: { $ref: getSchemaPath(model) } },
});

@ApiTags('machines')
@ApiBearerAuth('AccessBearer')
@ApiExtraModels(MachineSelectionHandoff, MachineContextChangedProblem)
@UseGuards(AccessSessionGuard)
@UseFilters(MachineErrorFilter)
@Controller('v1/machines')
export class MachineSelectionController {
    constructor(
        @Inject(RevalidateMachineSelectionService)
        private readonly selection: RevalidateMachineSelectionService,
    ) {}

    @Post(':machineId/selection-revalidation')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Revalidate current price and eligibility for typed handoff' })
    @ApiParam({ name: 'machineId', description: 'Immutable opaque public machine identifier', type: String })
    @ApiBody({ type: RevalidateMachineSelectionDto })
    @ApiOkResponse({
        description: 'Current eligible context; no purchase side effect occurred',
        type: MachineSelectionHandoff,
    })
    @ApiBadRequestResponse({
        content: problemContent(ValidationProblem),
        description: 'Invalid machine identifier or expected revision',
    })
    @ApiUnauthorizedResponse({ content: problemContent(Problem), description: 'Authentication is required' })
    @ApiNotFoundResponse({ content: problemContent(Problem), description: 'Machine not found' })
    @ApiConflictResponse({
        content: problemContent(MachineContextChangedProblem),
        description: 'Selection-relevant machine context changed',
    })
    @ApiUnprocessableEntityResponse({
        content: problemContent(Problem),
        description: 'Machine is not currently selectable',
    })
    @ApiServiceUnavailableResponse({
        content: problemContent(Problem),
        description: 'Machine information is temporarily unavailable',
    })
    async revalidate(
        @Param(new ValidationPipe(dtoValidation(MachineIdParamDto))) params: MachineIdParamDto,
        @Body(new ValidationPipe(dtoValidation(RevalidateMachineSelectionDto))) body: RevalidateMachineSelectionDto,
        @Req() request: Request & AuthSecurityRequest,
        @Res({ passthrough: true }) response: Response,
    ): Promise<MachineSelectionHandoffResponse | MachineContextChangedResponse> {
        response.setHeader('Cache-Control', 'no-store');

        try {
            const handoff = await this.selection.execute(
                parseMachineId(params.machineId),
                body.expectedMachineRevision as MachineRevision,
            );

            return toMachineSelectionHandoffResponse(handoff);
        } catch (error: unknown) {
            if (!isMachineContextChangedError(error)) throw error;

            response.status(HttpStatus.CONFLICT).type('application/problem+json');
            return toMachineContextChangedResponse(error.currentMachine, correlationId(request));
        }
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

function toMachineSelectionHandoffResponse(
    handoff: MachineSelectionHandoffProjection,
): MachineSelectionHandoffResponse {
    return {
        machineId: handoff.machineId,
        machineRevision: handoff.machineRevision,
        price: {
            amountPerLiter: handoff.price.amountPerLiter,
            currency: handoff.price.currency,
        },
        availability: handoff.availability,
        validatedAt: handoff.validatedAt,
    };
}

function isMachineContextChangedError(error: unknown): error is MachineContextChangedError {
    return (
        error instanceof MachineApplicationError &&
        error.code === 'MACHINE_CONTEXT_CHANGED' &&
        'currentMachine' in error
    );
}

function correlationId(request: Request & AuthSecurityRequest): string {
    const requestId = request.authRequestMetadata?.requestId;
    return requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
        ? requestId
        : randomUUID();
}
