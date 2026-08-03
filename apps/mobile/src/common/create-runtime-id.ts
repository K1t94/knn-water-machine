export function createRuntimeId(prefix: string): string {
    const cryptoValue: unknown = Reflect.get(globalThis, 'crypto');
    if (typeof cryptoValue === 'object' && cryptoValue !== null) {
        const randomUuid: unknown = Reflect.get(cryptoValue, 'randomUUID');
        if (typeof randomUuid === 'function') {
            const generated: unknown = Reflect.apply(randomUuid, cryptoValue, []);
            if (typeof generated === 'string') return generated;
        }
    }

    return `${prefix}-${Date.now().toString(36)}-${performance.now().toString(36).replace('.', '')}`;
}
