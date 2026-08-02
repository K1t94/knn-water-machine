import { Inject, Injectable } from '@nestjs/common';

import { RedisService } from './redis.service';

export interface RedisScript<TResult> {
    name: string;
    version: number;
    source: string;
    parse(result: unknown): TResult;
}

export interface RedisScriptInvocation {
    keys?: readonly string[];
    arguments?: readonly string[];
}

@Injectable()
export class RedisScriptRunner {
    private readonly shaByScript = new Map<string, string>();
    private readonly loadByScript = new Map<string, Promise<string>>();

    constructor(@Inject(RedisService) private readonly redis: RedisService) {}

    async invoke<TResult>(script: RedisScript<TResult>, invocation: RedisScriptInvocation = {}): Promise<TResult> {
        const sha = await this.getOrLoad(script);

        try {
            const result = await this.evaluate(sha, invocation);
            return script.parse(result);
        } catch (error) {
            if (!isNoScriptError(error)) {
                throw error;
            }

            this.shaByScript.delete(scriptKey(script));
            const recoveredSha = await this.getOrLoad(script);
            const result = await this.evaluate(recoveredSha, invocation);
            return script.parse(result);
        }
    }

    private async getOrLoad<TResult>(script: RedisScript<TResult>): Promise<string> {
        const key = scriptKey(script);
        const cached = this.shaByScript.get(key);
        if (cached) {
            return cached;
        }

        const inFlight = this.loadByScript.get(key);
        if (inFlight) {
            return inFlight;
        }

        const load = this.redis.commandClient
            .scriptLoad(script.source)
            .then((sha) => {
                this.shaByScript.set(key, sha);
                return sha;
            })
            .finally(() => this.loadByScript.delete(key));
        this.loadByScript.set(key, load);
        return load;
    }

    private evaluate(sha: string, invocation: RedisScriptInvocation): Promise<unknown> {
        return this.redis.commandClient.evalSha(sha, {
            keys: [...(invocation.keys ?? [])],
            arguments: [...(invocation.arguments ?? [])],
        });
    }
}

function scriptKey(script: Pick<RedisScript<unknown>, 'name' | 'version'>): string {
    return `${script.name}@${script.version}`;
}

function isNoScriptError(error: unknown): boolean {
    return error instanceof Error && /\bNOSCRIPT\b/i.test(error.message);
}
