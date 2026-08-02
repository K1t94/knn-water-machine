import {
    Body,
    Catch,
    Controller,
    Get,
    Injectable,
    Module,
    UseFilters,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';

import { OtpRequestDto } from '../src/auth/http/dto/otp.dto';

import type { CallHandler, CanActivate, ExceptionFilter, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

@Injectable()
class FixtureProvider {
    async execute(dto: OtpRequestDto): Promise<string> {
        await Promise.resolve();
        return dto.phone;
    }
}

@Injectable()
class FixtureGuard implements CanActivate {
    canActivate(_context: ExecutionContext): boolean {
        return true;
    }
}

@Injectable()
class FixtureInterceptor implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
        return next.handle();
    }
}

@Catch()
class FixtureFilter implements ExceptionFilter {
    catch(_exception: unknown, _host: unknown): void {}
}

@Controller('eslint-fixture')
@UseGuards(FixtureGuard)
@UseInterceptors(FixtureInterceptor)
@UseFilters(FixtureFilter)
class FixtureController {
    constructor(private readonly provider: FixtureProvider) {}

    @Get()
    execute(@Body() dto: OtpRequestDto): Promise<string> {
        return this.provider.execute(dto);
    }
}

@Module({
    controllers: [FixtureController],
    providers: [FixtureProvider, FixtureGuard, FixtureInterceptor, FixtureFilter],
})
export class FixtureModule {}
