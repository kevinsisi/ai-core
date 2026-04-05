## Context

`GeminiClient` in `@kevinsisi/ai-core` wraps `@google/generative-ai` and currently calls `model.generateContent(params.prompt)` with a plain string. The Gemini SDK supports a richer `Content` / `Part[]` format that accepts `InlineDataPart` (base64 + mimeType) and `FileDataPart` (URI) alongside `TextPart`. Callers like `onshape-skill` need to pass PNG screenshots of CAD models alongside a text prompt for vision analysis. The `tools` field is needed to enable Google Search grounding in some calls.

`systemInstruction` is already threaded through to `getGenerativeModel()` in both methods, so no changes are needed for requirement #5.

## Goals / Non-Goals

**Goals:**
- Add `images?: ImagePart[]` to `GenerateParams` supporting base64 inline data and file-path-based parts
- Add `tools?: Tool[]` to `GenerateParams` to pass Gemini tool declarations (e.g., `googleSearchRetrieval`)
- Both `generateContent` and `streamContent` build `Part[]` when images are present
- Zero breaking changes: callers that pass only `prompt` continue to work unchanged
- Unit tests cover all new code paths

**Non-Goals:**
- Video or audio input (out of scope for this change)
- File upload via Gemini Files API (base64 inline is sufficient for typical image sizes)
- Chat history with images (history stays text-only for now)
- Changing retry / key-pool logic

## Decisions

### D1: `ImagePart` as a discriminated union

```ts
export type ImagePart =
  | { type: "inline"; mimeType: string; data: string }   // base64
  | { type: "file"; mimeType: string; filePath: string }; // read from disk
```

**Rationale:** Explicit `type` discriminant is simpler and safer than inspecting whether a string looks like a path. Callers always know what they have. The `filePath` variant lets callers reference images on disk without pre-encoding.

**Alternative considered:** A single `{ data: string; mimeType: string }` where `data` is either base64 or a path — rejected because ambiguity forces a heuristic check (does it start with `/`? does it contain `:`?) which is fragile on Windows paths.

### D2: `buildParts()` helper converts `ImagePart[]` → SDK `Part[]`

A pure function `buildParts(prompt: string, images?: ImagePart[]): Part[]` is extracted from `gemini-client.ts`. It reads file content synchronously via `fs.readFileSync` for the `file` variant (images are small; async adds no value here).

**Rationale:** Pure function is easy to unit-test in isolation and keeps `generateContent` / `streamContent` readable.

**Alternative:** Inline the conversion in each method — rejected because it duplicates logic.

### D3: `tools` typed as `Tool[]` from the SDK

Re-export `Tool` from `@google/generative-ai` in `types.ts`. Callers compose `Tool[]` using the same SDK type they already depend on transitively.

**Rationale:** Avoids inventing a parallel type that must stay in sync with the SDK. Since `@google/generative-ai` is a direct dependency of `ai-core`, consumers always have access to its types.

### D4: Pass `tools` to `getGenerativeModel()` options

The SDK accepts `tools` and `toolConfig` at model level (not per-request). We pass it in the same options object alongside `systemInstruction`.

## Risks / Trade-offs

- **File read is synchronous** — acceptable because images are bounded in size and the SDK call is async anyway. If huge images are ever needed, callers should pre-encode. → Mitigation: document size recommendation in README.
- **`mimeType` must be correct** — the SDK does not validate MIME types; wrong values cause Gemini to reject the request. → Mitigation: document common values (`image/png`, `image/jpeg`) in README and types.
- **`Tool` type coupling** — if the SDK renames `Tool`, callers break. → Mitigation: thin re-export; version pin in package.json keeps changes controlled.

## Migration Plan

No migration needed. This is an additive change published as a minor version (`1.1.0`). Existing consumers update via `npm update @kevinsisi/ai-core` and gain the new fields; no code changes required unless they want images or tools.
