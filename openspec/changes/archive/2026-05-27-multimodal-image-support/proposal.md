## Why

`GeminiClient` only accepts text prompts today, but downstream projects like `onshape-skill` need to send images (CAD screenshots, diagrams) to Gemini for vision analysis. Adding multimodal support unblocks these use cases without requiring callers to drop down to the raw SDK.

## What Changes

- `GenerateParams` gains an optional `images` field accepting base64 inline data or file paths
- `GeminiClient.generateContent()` assembles `Part[]` arrays (text + image parts) before calling Gemini
- `GeminiClient.streamContent()` receives the same multimodal `Part[]` support
- `GenerateParams` gains an optional `tools` field for Gemini tool declarations (e.g., Google Search grounding)
- Unit tests cover: image-only, text+image, base64 vs file-path, tools field pass-through
- Version bumped to `1.1.0`

## Capabilities

### New Capabilities

- `multimodal-generate`: Extend `GenerateParams` with `images` (inline base64 or file path) and `tools` fields; `GeminiClient` converts them to `Part[]` and passes to Gemini's generateContent / generateContentStream APIs.

### Modified Capabilities

<!-- No existing spec files — no delta specs needed -->

## Impact

- **`src/client/types.ts`**: New `ImagePart` union type + `images?` and `tools?` on `GenerateParams`
- **`src/client/gemini-client.ts`**: `buildParts()` helper; both `generateContent` and `streamContent` pass `Part[]` instead of raw string when images present
- **`src/__tests__/client.test.ts`**: New test cases for multimodal paths
- **`package.json`**: version `1.0.0` → `1.1.0`
- **`README.md`**: Document new fields with usage examples
- **No breaking changes** — existing text-only callers unchanged
