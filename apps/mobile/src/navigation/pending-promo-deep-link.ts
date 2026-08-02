export function parsePendingPromo(url: string | null): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'kaynann:') return undefined;
        if (parsed.hostname !== 'register' && parsed.pathname.replace(/^\/+/, '') !== 'register') return undefined;
        return parsed.searchParams.get('promo')?.trim().slice(0, 64) || undefined;
    } catch {
        return undefined;
    }
}
