# Phase 8 Mobile Visual And Accessibility Checklist

**Feature**: `005-referral-program`  
**Reference**: `docs/design/mockups/06_referral_program_hd.png`  
**Prepared**: 2026-08-10

## Automated Evidence

- [x] Referral, apply-code, navigation, and deep-link tests pass.
- [x] Complete mobile test suite passes: 28 files, 113 tests.
- [x] Mobile TypeScript typecheck passes.
- [x] Mobile ESLint passes with zero warnings.
- [x] Expo production JS export succeeds for iOS and Android.
- [x] Tests reject mockup-only 20 L, full names, reward-after-purchase wording,
      sample data, and automatic promo application.
- [x] A 250-row privacy-safe invitation history renders without exposing full
      phone numbers.

## iOS Manual Verification

- [x] Phone-width loading, empty, loaded, refresh, error, and pagination states
      are visually correct.
- [x] Long localized/error text remains readable without clipping.
- [x] Wallet to referral, apply-code, and back navigation work.
- [x] Signed-in and signed-out referral links open the expected flow without
      automatic application.
- [x] Copy and system share actions work.
- [x] VoiceOver exposes meaningful button, alert, progress, input, and content
      labels.
- [x] Logout and restored-session behavior retain no previous user's referral
      data.

## Android Manual Verification

- [x] Phone-width loading, empty, loaded, refresh, error, and pagination states
      are visually correct.
- [x] Long localized/error text remains readable without clipping.
- [x] Wallet to referral, apply-code, and back navigation work.
- [x] Signed-in and signed-out referral links open the expected flow without
      automatic application.
- [x] Copy and system share actions work.
- [x] TalkBack exposes meaningful button, alert, progress, input, and content
      labels.
- [x] Logout and restored-session behavior retain no previous user's referral
      data.

## SC-005 Timed Runs

Measure from the fully loaded referral view. Copy and share are separate runs.

| Platform | Action | Run 1 | Run 2 | Result |
| --- | --- | --- | --- | --- |
| iOS | Locate and copy promo code/link | <=10 s | <=10 s | Pass |
| iOS | Locate and open system share | <=10 s | <=10 s | Pass |
| Android | Locate and copy promo code/link | <=10 s | <=10 s | Pass |
| Android | Locate and open system share | <=10 s | <=10 s | Pass |

The user confirmed on 2026-08-11 that all T086 checks pass on both supported
platforms. Exact durations were not recorded; each timed run was confirmed to be
within the required 10-second limit.
