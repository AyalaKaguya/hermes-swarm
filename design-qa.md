# Platform ticket composer — design QA

## Comparison target

- Source visual truth: `C:\Users\ayala\AppData\Local\Temp\codex-clipboard-543bde48-63c9-4e4d-b9a9-bfe787463ddf.png`
- Earlier implementation reference: `C:\Users\ayala\AppData\Local\Temp\codex-clipboard-a008a431-a047-4724-9c21-c8bdf938795b.png`
- Implementation route: `http://localhost:3100/platform/governance/tickets`
- Implementation screenshot path: unavailable — the in-app browser does not support `playwright_element_screenshot`.
- Viewport/state: desktop platform console; open ticket dialog; ticket has existing messages; reply composer is open.

## Evidence collected

The source image establishes a rounded, inset chat composer with circular add/send controls, a clean message surface, and a centered empty state.

The live page semantic and computed-style checks confirm:

- The composer uses the existing `PromptInput` / `InputGroup` primitives.
- Composer surface: `768 × 124px`, `18px` radius, muted translucent background, and no outer border.
- Add-image and send controls: `36 × 36px`, fully circular.
- The content grid resolves to `0px 606.4px 156.8px` with no alert present, keeping the composer in the bottom row and the message list in the scrollable middle row.
- The image action menu opens and exposes the `图片` action; no ticket data was changed during verification.

## Findings

- No actionable P0, P1, or P2 issue was found from the available live DOM and computed-style evidence.
- A full visual comparison cannot be completed because the selected in-app browser cannot capture an implementation screenshot. The source image and rendered implementation therefore could not be placed side by side.

## Patches made

- Replaced the manually assembled textarea and file input with the local shadcn AI Elements `PromptInput` composition.
- Added compact attachment previews, circular image/send actions, upload validation, blob-to-`File` conversion, and the empty conversation state.
- Corrected the dialog grid placement so optional error content cannot displace the conversation or composer.

## Follow-up polish

- Capture a full desktop comparison when screenshot support is available; the current report has no remaining code-side polish item.

final result: blocked
