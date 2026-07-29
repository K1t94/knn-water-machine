import { createServer, type Server } from 'node:http';

import { orangeFixtures } from './orange-fixtures';

export interface OrangeMockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
}

export interface OrangeMockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export class OrangeMockServer {
  private server?: Server;
  private originValue?: string;
  private readonly oauthQueue: OrangeMockResponse[] = [];
  private readonly smsQueue: OrangeMockResponse[] = [];
  readonly requests: OrangeMockRequest[] = [];

  get origin(): string {
    if (!this.originValue) throw new Error('Orange mock server is not started');
    return this.originValue;
  }
  get oauthUrl(): string { return `${this.origin}/oauth/v3/token`; }
  get apiUrl(): string { return `${this.origin}/smsmessaging/v1`; }

  enqueueOAuth(response: OrangeMockResponse): void { this.oauthQueue.push(response); }
  enqueueSms(response: OrangeMockResponse): void { this.smsQueue.push(response); }

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      this.requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const oauth = request.url === '/oauth/v3/token';
      const fixture = (oauth ? this.oauthQueue.shift() : this.smsQueue.shift()) ??
        (oauth
          ? { status: 200, body: orangeFixtures.oauthSuccess }
          : { status: 201, body: orangeFixtures.smsAccepted });
      if (fixture.delayMs) await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
      response.writeHead(fixture.status, { 'content-type': 'application/json', ...fixture.headers });
      response.end(JSON.stringify(fixture.body ?? {}));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Orange mock failed to bind');
    this.originValue = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()));
    this.server = undefined;
    this.originValue = undefined;
  }
}
