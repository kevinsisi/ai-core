## ADDED Requirements

### Requirement: GenerateParams accepts inline base64 images
`GenerateParams` SHALL include an optional `images` field typed as `ImagePart[]`. An `ImagePart` with `type: "inline"` SHALL carry a base64-encoded `data` string and a `mimeType` string (e.g., `"image/png"`).

#### Scenario: Inline image part is defined
- **WHEN** caller sets `images: [{ type: "inline", mimeType: "image/png", data: "<base64>" }]`
- **THEN** `GenerateParams` is valid TypeScript with no type errors

### Requirement: GenerateParams accepts file-path images
An `ImagePart` with `type: "file"` SHALL carry a `filePath` string pointing to an image on the local filesystem and a `mimeType` string. `GeminiClient` SHALL read the file synchronously and encode it as base64 before sending.

#### Scenario: File path is resolved to base64
- **WHEN** caller sets `images: [{ type: "file", mimeType: "image/jpeg", filePath: "/tmp/photo.jpg" }]`
- **THEN** the underlying Gemini SDK call receives an `InlineDataPart` with the file's base64-encoded content

### Requirement: generateContent assembles multimodal Part array
When `images` is provided, `GeminiClient.generateContent()` SHALL build a `Part[]` containing one `TextPart` (the prompt) followed by one `InlineDataPart` per image, and pass this array to the Gemini SDK instead of the raw prompt string.

#### Scenario: Text and image parts sent together
- **WHEN** caller provides `{ prompt: "Describe this", images: [{ type: "inline", mimeType: "image/png", data: "abc" }] }`
- **THEN** `model.generateContent` is called with `[{ text: "Describe this" }, { inlineData: { mimeType: "image/png", data: "abc" } }]`

#### Scenario: Text-only prompt unchanged
- **WHEN** caller provides only `{ prompt: "Hello" }` with no `images`
- **THEN** `model.generateContent` is called with the plain string `"Hello"` (backward-compatible)

### Requirement: streamContent assembles multimodal Part array
When `images` is provided, `GeminiClient.streamContent()` SHALL build the same `Part[]` array and pass it to `model.generateContentStream()`.

#### Scenario: Stream with image parts
- **WHEN** caller provides `images` in a `streamContent` call
- **THEN** `model.generateContentStream` receives `Part[]` with text + image parts

### Requirement: GenerateParams accepts tools declarations
`GenerateParams` SHALL include an optional `tools` field typed as `Tool[]` (from `@google/generative-ai`). When provided, it SHALL be passed to `getGenerativeModel()` so that Gemini can use the declared tools (e.g., Google Search grounding).

#### Scenario: Tools passed to model
- **WHEN** caller sets `tools: [{ googleSearchRetrieval: {} }]`
- **THEN** `getGenerativeModel` is called with `tools: [{ googleSearchRetrieval: {} }]`

#### Scenario: No tools by default
- **WHEN** caller does not set `tools`
- **THEN** `getGenerativeModel` is not called with a `tools` key (no unnecessary field)
