import { Injectable, Logger, type LoggerService } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface SafeAuthLogEvent {
  requestId?: string;
  category: string;
  route?: string;
  statusCode: number;
  latencyMs?: number;
  phoneFingerprint?: string;
  installationFingerprint?: string;
}

@Injectable()
export class SafeAuthLogger {
  constructor(private readonly sink: LoggerService = new Logger('AuthSecurity')) {}

  exception(event: SafeAuthLogEvent): void {
    this.sink.error(JSON.stringify({
      event: 'auth_request_failed',
      requestId: validRequestId(event.requestId),
      category: normalizedCategory(event.category),
      statusCode: event.statusCode,
      ...(safeRoute(event.route) ? { route: safeRoute(event.route) } : {}),
      ...(safeLatency(event.latencyMs) !== undefined
        ? { latencyMs: safeLatency(event.latencyMs) }
        : {}),
      ...(safeFingerprint(event.phoneFingerprint)
        ? { phoneFingerprint: event.phoneFingerprint }
        : {}),
      ...(safeFingerprint(event.installationFingerprint)
        ? { installationFingerprint: event.installationFingerprint }
        : {}),
    }));
  }
}

function validRequestId(value: string | undefined): string {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

function normalizedCategory(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'UNEXPECTED_ERROR';
}

function safeRoute(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const path = value.split('?', 1)[0];
  return /^\/[A-Za-z0-9_./:-]{1,200}$/.test(path) ? path : undefined;
}

function safeLatency(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.round(value), 3_600_000);
}

function safeFingerprint(value: string | undefined): boolean {
  return value !== undefined && /^[a-f0-9]{64}$/i.test(value);
}
