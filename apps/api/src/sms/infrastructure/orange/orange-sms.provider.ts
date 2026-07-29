import type {
  SendSmsCommand,
  SendSmsResult,
  SmsProvider,
} from '../../application/ports/sms-provider';
import { SmsProviderError } from '../../application/sms-error';
import type { OrangeOutboundRequest, OrangeOutboundResponse } from './orange.dto';
import { mapOrangeError, mapOrangeResponse } from './orange-error-mapper';
import { OrangeOAuthClient } from './orange-oauth-client';
import { withOrangeRetry, type OrangeRetryOptions } from './orange-retry';

export interface OrangeSmsConfig {
  apiUrl: string;
  senderAddress: string;
  senderName: string;
  timeoutMs?: number;
  retry?: OrangeRetryOptions;
  receiptCallbackUrl?: string;
}

export class OrangeSmsProvider implements SmsProvider {
  readonly name = 'orange';
  readonly delivery = {
    supported: true,
    statusCategories: ['delivered', 'pending', 'uncertain', 'failed'],
  } as const;

  constructor(
    private readonly oauth: OrangeOAuthClient,
    private readonly config: OrangeSmsConfig,
    private readonly http: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.validateConfig();
  }

  send(command: SendSmsCommand): Promise<SendSmsResult> {
    if (!/^\+221\d{9}$/.test(command.recipientE164)) {
      return Promise.reject(new SmsProviderError('INVALID_RECIPIENT', false));
    }
    return withOrangeRetry(() => this.sendAttempt(command), this.config.retry ?? {
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 1_000,
    });
  }

  private async sendAttempt(
    command: SendSmsCommand,
    refreshed = false,
  ): Promise<SendSmsResult> {
    const token = await this.oauth.getAccessToken();
    const request: OrangeOutboundRequest = {
      outboundSMSMessageRequest: {
        address: `tel:${command.recipientE164}`,
        senderAddress: this.config.senderAddress,
        senderName: this.config.senderName,
        outboundSMSTextMessage: { message: command.message },
        ...(this.config.receiptCallbackUrl
          ? { receiptRequest: {
              notifyURL: this.config.receiptCallbackUrl,
              callbackData: command.correlationId,
            } }
          : {}),
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
    let response: Response;
    try {
      response = await this.http(this.sendUrl(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (cause) {
      throw mapOrangeError({ operation: 'send', cause, aborted: controller.signal.aborted }).error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const mapped = await mapOrangeResponse(response, 'send');
      if (mapped.expiredCredential && !refreshed) {
        this.oauth.invalidate(token);
        return this.sendAttempt(command, true);
      }
      throw mapped.error;
    }

    let payload: OrangeOutboundResponse;
    try {
      payload = (await response.json()) as OrangeOutboundResponse;
    } catch {
      throw new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
    }
    const resource = payload.outboundSMSMessageRequest?.resourceURL;
    const providerMessageId = typeof resource === 'string'
      ? resource.split('/').filter(Boolean).at(-1)
      : undefined;
    if (!providerMessageId) {
      throw new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
    }
    return { status: 'accepted', providerMessageId, acceptedAt: this.now() };
  }

  private sendUrl(): string {
    return `${this.config.apiUrl.replace(/\/$/, '')}/outbound/${encodeURIComponent(this.config.senderAddress)}/requests`;
  }

  private validateConfig(): void {
    if (
      !/^tel:\+221\d+$/.test(this.config.senderAddress) ||
      !/^[A-Za-z0-9 ]{1,11}$/.test(this.config.senderName) ||
      !isSecureOrangeUrl(this.config.apiUrl) ||
      (this.config.receiptCallbackUrl !== undefined &&
        !isPublicHttpsUrl(this.config.receiptCallbackUrl))
    ) {
      throw new SmsProviderError('INVALID_CONFIGURATION', false);
    }
  }
}

function isSecureOrangeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
