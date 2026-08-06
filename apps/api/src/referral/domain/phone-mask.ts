const canonicalPhonePattern = /^\+[1-9]\d{7,14}$/;

export function maskReferralPhone(phone: string): string {
    if (!canonicalPhonePattern.test(phone)) return '**';

    return `**${phone.slice(-2)}`;
}
