const GSM_7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_7_EXTENSION = '^{}\\[~]|€';
const URL_PATTERN = /(?:https?:\/\/|www\.)/i;
const MAX_SINGLE_SEGMENT_SEPTETS = 160;

export function buildOtpSms(otp: string): string {
  if (!/^\d{6}$/.test(otp)) {
    throw new Error('OTP must contain exactly six digits');
  }
  const message = `KAYNANN code: ${otp}. Valid for 5 minutes.`;
  assertSingleGsm7Segment(message);
  if (URL_PATTERN.test(message)) {
    throw new Error('OTP SMS must not contain links');
  }
  return message;
}

export function gsm7SeptetLength(message: string): number {
  let length = 0;
  for (const character of message) {
    if (GSM_7_BASIC.includes(character)) {
      length += 1;
    } else if (GSM_7_EXTENSION.includes(character)) {
      length += 2;
    } else {
      throw new Error('OTP SMS contains a non-GSM-7 character');
    }
  }
  return length;
}

function assertSingleGsm7Segment(message: string): void {
  if (gsm7SeptetLength(message) > MAX_SINGLE_SEGMENT_SEPTETS) {
    throw new Error('OTP SMS exceeds one GSM-7 segment');
  }
}
