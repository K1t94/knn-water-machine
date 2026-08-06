import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import { defer, from, map } from 'rxjs';

import type { Observable } from 'rxjs';

export interface ReferralClipboardPort {
    setStringAsync(value: string): Promise<unknown>;
}

export interface ReferralSharePort {
    share(content: { message: string }): Promise<unknown>;
}

export interface ReferralNativeCommands {
    copyPromoCode(promoCode: string): Observable<void>;
    shareReferralLink(referralLink: string): Observable<void>;
}

export class ReferralNativeActions implements ReferralNativeCommands {
    constructor(
        private readonly clipboard: ReferralClipboardPort = Clipboard,
        private readonly platformShare: ReferralSharePort = Share,
    ) {}

    copyPromoCode(promoCode: string): Observable<void> {
        return defer(() => from(this.clipboard.setStringAsync(promoCode))).pipe(map(() => undefined));
    }

    shareReferralLink(referralLink: string): Observable<void> {
        return defer(() => from(this.platformShare.share({ message: referralLink }))).pipe(map(() => undefined));
    }
}
