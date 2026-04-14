## 1. Provider / Model Schema

- [x] 1.1 Add `ProviderID` / `ModelID` types
- [x] 1.2 Add provider definition and model definition types
- [x] 1.3 Add model capability metadata (streaming, tools, reasoning, multimodal, limits)

## 2. Provider Registry & Auth

- [x] 2.1 Add provider registry primitives
- [x] 2.2 Add provider auth abstraction for consumer-supplied API-key style providers
- [x] 2.3 Leave room for later OAuth-style provider auth in the type model without introducing a generalized credential store in phase 1

## 3. Provider Adapters

- [x] 3.1 Add Gemini provider adapter
- [x] 3.2 Add OpenAI provider adapter
- [x] 3.3 Keep current Gemini compatibility layer working

## 4. Routing Policy

- [x] 4.1 Add provider/model routing policy primitives
- [x] 4.2 Support provider -> model -> credential selection order
- [x] 4.3 Define explicit opt-in fallback behavior for same-provider key rotation, cross-model fallback, and cross-provider fallback

## 5. Tests

- [x] 5.1 Test provider/model schema validation
- [x] 5.2 Test Gemini adapter behavior
- [x] 5.3 Test OpenAI adapter behavior
- [x] 5.4 Test routing policy selection and fallback ordering

## 6. Docs

- [x] 6.1 Update `README.md` architecture section
- [x] 6.2 Update `CLAUDE.md` with provider-aware layering guidance

## 7. Verification

- [x] 7.1 Run `npm run build`
- [x] 7.2 Run `npm test`
- [x] 7.3 Bump version if implementation lands
