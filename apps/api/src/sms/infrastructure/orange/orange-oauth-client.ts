import { SmsProviderError } from '../../application/sms-error';
import type { OrangeOAuthResponse } from './orange.dto';
import { mapOrangeError, mapOrangeResponse } from './orange-error-mapper';

export interface OrangeOAuthConfig {
  clientId: string;
  clientSecret: string;
  oauthUrl: string;
  safetySkewSeconds?: number;
  timeoutMs?: number;
}

export class OrangeOAuthClient {
  private cached?: { token: string; usableUntil: number };
  private refresh?: Promise<string>;

  constructor(
    private readonly config: OrangeOAuthConfig,
    private readonly http: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !config.clientId.trim() ||
      !config.clientSecret.trim() ||
      !isSecureOrangeUrl(config.oauthUrl)
    ) {
      throw new SmsProviderError('INVALID_CONFIGURATION', false);
    }
  }

  getAccessToken(): Promise<string> {
    if (this.cached && this.cached.usableUntil > this.now()) {
      return Promise.resolve(this.cached.token);
    }
    if (!this.refresh) {
      this.refresh = this.acquire().finally(() => {
        this.refresh = undefined;
      });
    }
    return this.refresh;
  }

  invalidate(token?: string): void {
    if (!token || this.cached?.token === token) this.cached = undefined;
  }

  private async acquire(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
    let response: Response;
    try {
      response = await this.http(this.config.oauthUrl, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: controller.signal,
      });
    } catch (cause) {
      throw mapOrangeError({ operation: 'oauth', cause, aborted: controller.signal.aborted }).error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw (await mapOrangeResponse(response, 'oauth')).error;

    let payload: OrangeOAuthResponse;
    try {
      payload = (await response.json()) as OrangeOAuthResponse;
    } catch {
      throw new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
    }
    const expiresIn = Number(payload.expires_in);
    if (
      payload.token_type?.toLowerCase() !== 'bearer' ||
      typeof payload.access_token !== 'string' ||
      !payload.access_token ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
    }
    this.cached = {
      token: payload.access_token,
      usableUntil: this.now() + Math.max(0, expiresIn - (this.config.safetySkewSeconds ?? 30)) * 1_000,
    };
    return payload.access_token;
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
