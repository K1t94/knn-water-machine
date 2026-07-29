import { parsePhoneNumberFromString } from 'libphonenumber-js';

export type PhoneErrorCode = 'INVALID_PHONE' | 'UNSUPPORTED_COUNTRY';

export class PhoneValidationError extends Error {
  constructor(public readonly code: PhoneErrorCode) {
    super(code);
    this.name = 'PhoneValidationError';
  }
}

export function normalizeSenegalPhone(input: string): string {
  const value = input.trim();
  const phone = parsePhoneNumberFromString(value, 'SN');

  if (phone?.country && phone.country !== 'SN') {
    throw new PhoneValidationError('UNSUPPORTED_COUNTRY');
  }
  if (!phone || !phone.isValid() || phone.country !== 'SN') {
    throw new PhoneValidationError('INVALID_PHONE');
  }

  return phone.number;
}
