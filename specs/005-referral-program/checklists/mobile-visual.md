# Phase 8 Mobile Visual And Accessibility Checklist

**Feature**: `005-referral-program`  
**Reference**: `docs/design/mockups/06_referral_program_hd.png`  
**Prepared**: 2026-08-13

## Automated Evidence

- [x] Complete mobile suite passes: 30 files, 126 tests.
- [x] Mobile TypeScript typecheck passes.
- [x] Expo production JS export succeeds for iOS and Android.
- [x] Static navigation regression proves `ApplyReferralCodeScreen` and its
      route are absent from production source.
- [x] Tests cover unknown/disabled UI hiding, signed-in link rejection,
      pending-code clearing, stale-request cancellation, and enabled sharing.
- [x] The mockup was inspected for hierarchy and visual direction; obsolete
      apply-code/purchase eligibility and illustrative data were not restored.
- [x] A 250-row privacy-safe history renders without full phone numbers.

## iOS Manual Verification

- [ ] Loading, empty, loaded, refresh, error, and pagination states are visually
      correct at phone widths.
- [ ] Enabled hierarchy follows the mockup without apply-code or purchase-
      eligibility UI.
- [ ] Within five seconds of authoritative disable, navigation, screen,
      registration promo input, code/link, totals, history, copy, and share are
      all absent.
- [ ] Long localized/error text remains readable without clipping.
- [ ] Signed-out links populate only editable registration context; signed-in
      links expose no apply action.
- [ ] Copy and system share actions work.
- [ ] VoiceOver labels buttons, alerts, progress, input, and content meaningfully.
- [ ] Logout/restored-session behavior retains no previous user's referral data.

## Android Manual Verification

- [ ] Loading, empty, loaded, refresh, error, and pagination states are visually
      correct at phone widths.
- [ ] Enabled hierarchy follows the mockup without apply-code or purchase-
      eligibility UI.
- [ ] Within five seconds of authoritative disable, navigation, screen,
      registration promo input, code/link, totals, history, copy, and share are
      all absent.
- [ ] Long localized/error text remains readable without clipping.
- [ ] Signed-out links populate only editable registration context; signed-in
      links expose no apply action.
- [ ] Copy and system share actions work.
- [ ] TalkBack labels buttons, alerts, progress, input, and content meaningfully.
- [ ] Logout/restored-session behavior retains no previous user's referral data.

## SC-005 Timed Runs

Measure from the fully loaded referral view. Copy and share are separate runs.

| Platform | Action | Run 1 | Run 2 | Result |
| --- | --- | --- | --- | --- |
| iOS | Locate and copy promo code/link | Pending | Pending | Pending |
| iOS | Locate and open system share | Pending | Pending | Pending |
| Android | Locate and copy promo code/link | Pending | Pending | Pending |
| Android | Locate and open system share | Pending | Pending | Pending |

Automated checks pass, but T083 remains open until the current build is manually
compared on both platforms and exact timed runs are recorded.
