import { MachineValidationError, parseMachineId, parseMachineIdentifierInput } from './machine-validation';

import type { MachineId, MachineIdentifierInput, MachineIdentifierKind } from './machine.types';

export interface IdentifierNormalizationOptions {
    readonly legacyQrEnabled: boolean;
}

export type NormalizedMachineIdentifier =
    | Readonly<{
          kind: 'CURRENT_QR';
          normalizedValue: MachineId;
      }>
    | Readonly<{
          kind: MachineIdentifierKind;
          normalizedValue: string;
      }>;

const CURRENT_MANUAL_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
const LEGACY_MANUAL_PATTERN = /^WM-[0-9]{4}$/;
const LEGACY_QR_PATTERN = /^KNNLEGACY:[0-9]{4}$/;
const CURRENT_QR_PATTERN = /^kaynann:\/\/machine\/v1\/([A-Za-z0-9_-]{22})$/;

function invalidIdentifier(): never {
    throw new MachineValidationError('INVALID_IDENTIFIER');
}

function normalizeManual(value: string): NormalizedMachineIdentifier {
    const normalizedValue = value.trim().toUpperCase();

    if (LEGACY_MANUAL_PATTERN.test(normalizedValue)) {
        return { kind: 'LEGACY_MANUAL', normalizedValue };
    }
    if (CURRENT_MANUAL_PATTERN.test(normalizedValue)) {
        return { kind: 'CURRENT_MANUAL', normalizedValue };
    }

    return invalidIdentifier();
}

function normalizeQr(value: string, options: IdentifierNormalizationOptions): NormalizedMachineIdentifier {
    const currentMatch = CURRENT_QR_PATTERN.exec(value);
    if (currentMatch !== null) {
        return {
            kind: 'CURRENT_QR',
            normalizedValue: parseMachineId(currentMatch[1]),
        };
    }

    if (options.legacyQrEnabled && LEGACY_QR_PATTERN.test(value)) {
        return { kind: 'LEGACY_QR', normalizedValue: value };
    }

    return invalidIdentifier();
}

export function normalizeMachineIdentifier(
    input: MachineIdentifierInput,
    options: IdentifierNormalizationOptions,
): NormalizedMachineIdentifier {
    const validatedInput = parseMachineIdentifierInput(input);

    return validatedInput.source === 'MANUAL'
        ? normalizeManual(validatedInput.value)
        : normalizeQr(validatedInput.value, options);
}
