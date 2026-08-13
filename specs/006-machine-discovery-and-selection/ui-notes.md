# Machine Selection UI Notes

## Source And Scope

- Visual reference: `docs/design/mockups/03_machine_selection_hd.png`.
- These notes describe presentation direction only. The feature specification
  and MVP requirements remain authoritative for data, behavior, states, and
  supported actions.
- Search, filtering, bottom-navigation destinations, labels, and icons visible
  in the mockup do not by themselves approve additional behavior for this
  feature.

## Responsive Hierarchy

1. Respect the device safe area, then present a compact header with a back
   action, centered screen title, and an optional trailing control.
2. Keep the primary discovery control below the header and visually separate
   from the results.
3. Present the map as the dominant first result surface, followed immediately
   by the corresponding machine list so both discovery modes feel connected.
4. Keep machine results vertically scrollable. If application navigation is
   present, it remains fixed outside the result scroll area and respects the
   bottom safe area.
5. On shorter screens, preserve header and control usability before map height;
   reduce the map viewport rather than compressing card content below readable
   or touchable sizes.
6. On wider screens, cap the content width and expand the map and cards within
   that column instead of stretching text lines and controls edge to edge.

## Spacing And Shape

- Use consistent horizontal page gutters for the header, primary control, map,
  and cards.
- Separate major regions with more space than the internal gaps within a card.
- Give the map and cards softly rounded corners; cards use a subtle border or
  low-elevation shadow rather than heavy visual separation.
- Keep card padding sufficient for status, distance, and multiline address
  values without collisions. Optional fields should collapse cleanly without
  leaving placeholder gaps.
- Preserve comfortable touch targets for header actions, markers, cards, and
  map/list controls even when their visible icons are smaller.

## Typography

- The screen title and machine name form the strongest text hierarchy and use
  a semibold or bold weight.
- Address and distance are secondary, lower-emphasis text, while the
  authoritative price remains easy to scan.
- Status is compact and visually distinct, but must not rely on color alone.
- Allow safe names and addresses to wrap or truncate predictably; do not reduce
  text below accessible platform sizes to reproduce the mockup proportions.
- Support system text scaling without overlapping the status, distance, or
  card action areas.

## Map And Markers

- The map is a rounded rectangular surface with restrained visual detail so
  markers remain the strongest elements.
- Distinguish the user's current position from machine markers by both shape
  and treatment. The location indicator is not selectable machine content.
- Provide distinct marker treatments for `ONLINE`, `SERVICE`, and `OFFLINE`;
  use shape, badge, or icon differences in addition to status color.
- A selected marker needs a clear selected state and a direct visual
  relationship to its machine summary or card.
- Only machines with server-provided valid coordinates receive markers. Do not
  fabricate coordinates for list-only or unavailable-location states.
- Map loading and unavailable-map states should occupy the same surface without
  causing the surrounding layout to jump.

## Cards And List Controls

- Each card groups one physical machine: safe display name, address, normalized
  status, authoritative price per liter and currency, and optional distance.
- Keep identity and address in the main content column. Align compact status
  and distance metadata consistently without allowing them to cover long text.
- The entire card may provide the primary opening target, with pressed,
  keyboard/accessibility focus, disabled, and loading feedback as applicable.
- Map/list switching should be explicit and preserve the current discovery
  context. Its control may be placed near the result surface, but it must not
  obscure map content or compete with the screen title.
- Paginated loading belongs at the end of the list and must not replace already
  visible cards.
- Machine imagery in the mockup is illustrative and is not required. Prefer a
  neutral placeholder or no image until an approved asset and API contract
  exist.

## State Treatment

- `ONLINE`, `SERVICE`, and `OFFLINE` require readable text labels and consistent
  marker/card treatments. Only authoritative server state is displayed.
- Loading should preserve the overall map/list geometry and avoid presenting
  fabricated machine values.
- Empty catalog, catalog error, location denied or unavailable, and map
  unavailable are separate states. Where the specification allows it, keep the
  list and retry path available instead of blocking the whole screen.
- When distance is unavailable, omit it cleanly; do not show a guessed value.
- Unavailable machines remain discoverable but must present a clear reason that
  selection cannot continue.

## Explicit Exclusions

- Do not copy Ghana-specific addresses or place names from the mockup.
- Do not copy its currency, prices, distances, machine names, or any other fixed
  sample values.
- Do not infer production copy, search/filter behavior, or navigation behavior
  solely from the image.
- Do not use the pictured machine artwork unless it is separately approved and
  supplied as a project asset.
- Render only server-provided values or neutral placeholders allowed by the
  specification.

## QR Scanner Reference

### Source And Limits

- Visual reference: `docs/design/mockups/10_qr_scanner_hd.png`.
- The reference defines scanner hierarchy and presentation direction only.
  Scanner behavior, supported payloads, errors, permissions, navigation, and
  copy remain governed by the feature specification.
- The photographed machine, visible QR content, prices, units, navigation
  labels, and other sample data are illustrative and must not be reproduced.

### Scanner Hierarchy And Safe Area

1. Respect the top safe area before a compact header containing a back action
   and a centered scanner title. Any trailing control must not displace the
   title or reduce the back action's touch target.
2. Place the camera preview immediately below the header and make it the
   dominant surface. Use rounded upper corners while preserving enough height
   for the target and instructions on compact screens.
3. Keep the lower safe area clear of primary scanner actions. Bottom
   navigation shown in the reference is not required by this feature and must
   not be inferred from the image.
4. On short or landscape layouts, reduce the preview height before compressing
   header actions, instructions, or manual-entry controls below accessible
   sizes.

### Preview And Overlay

- Place a short, high-contrast instruction near the top of the preview without
  covering the scanning target.
- Use four restrained corner guides to indicate the target region. The guides
  should remain visible against light and dark camera content without implying
  that only the exact framed area can be detected.
- Keep optional camera controls visually secondary and outside the target
  guides. Their presence in the reference does not approve gallery import or
  any other scanner capability.
- Do not embed the photographed machine or a sample QR image in the screen;
  the live camera feed is the preview content.

### Manual Fallback And Keyboard

- Keep a clearly labelled manual-code fallback visually associated with the
  scanner and reachable without a successful permission grant or scan.
- When manual entry opens, move focus deliberately to the controlled input and
  use keyboard avoidance so the field, validation message, cancel action, and
  submit action remain visible and reachable.
- On compact screens, allow the manual form to scroll rather than shrinking
  text or touch targets. Dismissing the keyboard must not submit or discard the
  entered code implicitly.

### Permission And Focus States

- Permission states are not depicted in the reference. Present
  `undetermined`, denied/restricted/revoked, and unavailable states within the
  preview region so the surrounding layout does not jump, while retaining the
  manual fallback.
- Start the live preview only while the scanner route is focused and the app is
  active. Focus loss, backgrounding, explicit cancel, or navigation away must
  stop the preview and detections.
- Resolving, invalid-code, not-found, and retryable connectivity states should
  preserve the scanner hierarchy and use consumer-safe text from the approved
  requirements; do not derive error copy or behavior from the image.

## Machine Detail And Confirmation Reference

### Source And Limits

- Visual reference: `docs/design/mockups/04_machine_purchase_hd.png`.
- Use the reference only for the machine-card hierarchy and the presentation of
  the current status, price per liter, and primary confirmation action. The
  feature specification remains authoritative for data, behavior, and states.

### Hierarchy And Spacing

1. Respect the top safe area, then use a compact header with a back action and
   the safe machine name as the strongest screen identifier.
2. Present machine identity, address, status, and optional distance together in
   one rounded summary card near the top of the content.
3. Give the authoritative price per liter its own rounded card immediately
   after the machine summary so it remains easy to find without competing with
   identity and availability.
4. Place one full-width primary confirmation action after the read-only detail
   cards, separated by a clear vertical gap and kept reachable above the bottom
   safe area.
5. Preserve consistent page gutters, card padding, and larger gaps between
   major cards than between related values inside a card. On compact screens,
   scroll the content instead of compressing text or touch targets.

### Typography, Status, And Price

- Use a bold or semibold safe machine name, with the address and optional
  distance at lower emphasis and predictable wrapping.
- Display the normalized status as a compact text label with an accompanying
  marker or badge; color may reinforce the state but must not be its only cue.
- Make the numeric price the strongest value inside the price card. Keep its
  currency visually attached and label it explicitly as the price for one
  liter using approved application copy.
- Render only refreshed server-provided values. Missing or unavailable values
  use specification-approved state treatment rather than illustrative
  substitutes.

### Primary Confirmation

- Use a visually dominant, wide, rounded primary button for the single machine
  confirmation action. Its label must describe selection or continuation, not
  purchase, payment, reservation, or dispensing.
- Preserve clear enabled, pressed, loading, and disabled treatments. Published
  `SERVICE` and `OFFLINE` machines remain readable but the confirmation action
  is visibly unavailable and accompanied by the approved explanation.
- Keep secondary header controls visually subordinate. Their presence in the
  mockup does not approve favorites or another competing action.

### Explicit Exclusions

- Do not reproduce volume controls, quantity presets, totals, checkout,
  purchase/payment content, or purchase-specific button copy from the mockup.
- Do not copy the sample machine name, address, distance, status copy, price,
  currency, quantities, totals, or bottom-navigation destinations.
- Do not use the pictured machine artwork unless an approved asset and public
  API field are supplied separately; the hierarchy must work without imagery.

## T117 Visual Validation

Validation date: 2026-08-31.

The implemented Wallet entry, discovery, detail, and scanner screens were
compared with mockups `02`, `03`, `04`, and `10` at the following CSS
viewports. Every referenced PNG was opened and inspected after capture.

| Viewport | Wallet | Discovery | Detail | Scanner |
| --- | --- | --- | --- | --- |
| iOS compact, 320 x 568 | `visual-validation/wallet-ios-compact-320x568.png` | `visual-validation/discovery-ios-compact-320x568.png` | `visual-validation/detail-ios-compact-320x568.png` | `visual-validation/scanner-ios-compact-320x568.png` |
| iOS large, 430 x 932 | `visual-validation/wallet-ios-large-430x932.png` | `visual-validation/discovery-ios-large-430x932.png` | `visual-validation/detail-ios-large-430x932.png` | `visual-validation/scanner-ios-large-430x932.png` |
| Android compact, 360 x 640 | `visual-validation/wallet-android-compact-360x640.png` | `visual-validation/discovery-android-compact-360x640.png` | `visual-validation/detail-android-compact-360x640.png` | `visual-validation/scanner-android-compact-360x640.png` |
| Android large, 412 x 915 | `visual-validation/wallet-android-large-412x915.png` | `visual-validation/discovery-android-large-412x915.png` | `visual-validation/detail-android-large-412x915.png` | `visual-validation/scanner-android-large-412x915.png` |

### Material Differences And Resolutions

- Wallet keeps the approved balance, machine-entry, referral, and history
  content instead of the mockup's illustrative business values. The content
  now uses compact gutters on short screens and a centered maximum width on
  larger layouts.
- Discovery preserves the specified map/list switch, normalized availability,
  distance, price, and manual-code entry. The web capture intentionally shows
  the unavailable-map fallback rather than fabricating map tiles or machine
  coordinates.
- Detail omits the mockup's purchase quantity, total, and payment controls. The
  safe machine identity and current availability are now grouped in one
  summary card, while authoritative price per liter is in a separate card.
- Scanner preserves only the approved live-camera hierarchy and manual-code
  fallback. It does not reproduce the photographed machine, sample QR code, or
  unrelated mockup controls.
- The screenshots use a clearly labelled validation fixture with Senegalese
  context. No Ghana addresses, MTN data, fixed `128 L` balance, user identity,
  or other illustrative mockup business data is present.
- No clipping, horizontal overflow, inaccessible primary action, or Safe Area
  overlap was observed in the 16 inspected captures.

These PNGs are Expo Web layout proxies because this development machine has no
installed iOS simulator runtime or connected Android device. They validate
responsive hierarchy, spacing, wrapping, and Safe Area allocation; they do not
validate native map rendering or the live camera feed. Those native surfaces
still require physical-device validation.
