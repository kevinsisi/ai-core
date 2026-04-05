## 1. Types

- [x] 1.1 Add `ImagePart` discriminated union type to `src/client/types.ts` (inline base64 + file-path variants)
- [x] 1.2 Add `images?: ImagePart[]` field to `GenerateParams` interface
- [x] 1.3 Add `tools?: Tool[]` field to `GenerateParams` (import `Tool` from `@google/generative-ai`)

## 2. Core Implementation

- [x] 2.1 Add `buildParts(prompt: string, images?: ImagePart[]): Part[]` helper in `gemini-client.ts` that reads file images synchronously and constructs SDK `Part[]`
- [x] 2.2 Update `generateContent()` to pass `Part[]` to `model.generateContent()` when `images` is set, plain string otherwise
- [x] 2.3 Update `streamContent()` to pass `Part[]` to `model.generateContentStream()` when `images` is set
- [x] 2.4 Thread `tools` through to `getGenerativeModel()` options in both `generateContent` and `streamContent`

## 3. Tests

- [x] 3.1 Test: `generateContent` with inline base64 image sends correct `InlineDataPart`
- [x] 3.2 Test: `generateContent` with `type: "file"` image reads file and sends base64
- [x] 3.3 Test: `generateContent` text-only still passes plain string (backward compat)
- [x] 3.4 Test: `streamContent` with images passes `Part[]` to `generateContentStream`
- [x] 3.5 Test: `tools` field is passed to `getGenerativeModel()`

## 4. Version & Docs

- [x] 4.1 Bump version in `package.json` from `1.0.0` to `1.1.0`
- [x] 4.2 Update `README.md` with multimodal usage examples and `tools` field docs

## 5. Verification

- [x] 5.1 Run `npm run build` — ensure it compiles without errors
- [x] 5.2 Run `npm test` — ensure all tests pass
