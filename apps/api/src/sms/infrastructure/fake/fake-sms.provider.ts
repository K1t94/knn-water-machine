import { loadEnv } from '../../../config/env';
import type {
  SendSmsCommand,
  SendSmsResult,
  SmsProvider,
} from '../../application/ports/sms-provider';
import { SmsProviderError } from '../../application/sms-error';
import { FakeSmsOutbox } from './fake-sms.outbox';

export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly delivery = {
    supported: false,
    statusCategories: [
      'delivered',
      'pending',
      'uncertain',
      'failed',
    ] as const,
  };

  private readonly env = loadEnv();
  private readonly allowlistedNumbers = new Set(
    this.env.FAKE_SMS_TEST_NUMBERS.split(',')
      .map((number) => number.trim())
      .filter(Boolean),
  );

  constructor(
    private readonly outbox: FakeSmsOutbox,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!['development', 'test'].includes(this.env.APP_ENV)) {
      throw new SmsProviderError('INVALID_CONFIGURATION', false);
    }
  }

  async send(command: SendSmsCommand): Promise<SendSmsResult> {
    const failure = this.outbox.consumeFailure(command.recipientE164);
    if (failure) {
      throw failure;
    }

    this.outbox.record(
      command,
      this.env.FAKE_SMS_EXPOSE_OTP,
      this.allowlistedNumbers.has(command.recipientE164),
    );
    return {
      status: 'accepted',
      providerMessageId: `fake:${command.correlationId}`,
      acceptedAt: this.now(),
    };
  }
}
