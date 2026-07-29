import { Injectable } from '@nestjs/common';

import type { SendSmsCommand } from '../../application/ports/sms-provider';
import type { SmsProviderError } from '../../application/sms-error';

export interface FakeSmsInspection {
  recipientE164: string;
  otp: string;
  correlationId: string;
}

const MAX_OUTBOX_ENTRIES = 100;

@Injectable()
export class FakeSmsOutbox {
  private readonly inspections: FakeSmsInspection[] = [];
  private readonly nextFailures = new Map<string, SmsProviderError>();

  record(
    command: SendSmsCommand,
    exposeOtp: boolean,
    allowlisted: boolean,
  ): void {
    if (!exposeOtp || !allowlisted) {
      return;
    }

    const otp = /\b(\d{6})\b/.exec(command.message)?.[1];

    if (!otp) {
      return;
    }
    this.inspections.push({
      recipientE164: command.recipientE164,
      otp,
      correlationId: command.correlationId,
    });
    if (this.inspections.length > MAX_OUTBOX_ENTRIES) {
      this.inspections.splice(0, this.inspections.length - MAX_OUTBOX_ENTRIES);
    }
  }

  latestFor(recipientE164: string): FakeSmsInspection | undefined {
    for (let index = this.inspections.length - 1; index >= 0; index -= 1) {
      const entry = this.inspections[index];
      if (entry.recipientE164 === recipientE164) {
        return entry;
      }
    }
    return undefined;
  }

  failNext(recipientE164: string, error: SmsProviderError): void {
    this.nextFailures.set(recipientE164, error);
  }

  consumeFailure(recipientE164: string): SmsProviderError | undefined {
    const error = this.nextFailures.get(recipientE164);
    this.nextFailures.delete(recipientE164);
    return error;
  }

  clear(): void {
    this.inspections.splice(0);
    this.nextFailures.clear();
  }
}
