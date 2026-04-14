## 1. Provider / Model Schema

- [ ] 1.1 Add `ProviderID` / `ModelID` types
- [ ] 1.2 Add provider definition and model definition types
- [ ] 1.3 Add model capability metadata (streaming, tools, reasoning, multimodal, limits)

## 2. Provider Registry & Auth

- [ ] 2.1 Add provider registry primitives
- [ ] 2.2 Add provider auth abstraction for consumer-supplied API-key style providers
- [ ] 2.3 Leave room for later OAuth-style provider auth in the type model without introducing a generalized credential store in phase 1

## 3. Provider Adapters

- [ ] 3.1 Add Gemini provider adapter
- [ ] 3.2 Add OpenAI provider adapter
- [ ] 3.3 Keep current Gemini compatibility layer working

## 4. Routing Policy

- [ ] 4.1 Add provider/model routing policy primitives
- [ ] 4.2 Support provider -> model -> credential selection order
- [ ] 4.3 Define explicit opt-in fallback behavior for same-provider key rotation, cross-model fallback, and cross-provider fallback

## 5. Tests

- [ ] 5.1 Test provider/model schema validation
- [ ] 5.2 Test Gemini adapter behavior
- [ ] 5.3 Test OpenAI adapter behavior
- [ ] 5.4 Test routing policy selection and fallback ordering

## 6. Docs

- [ ] 6.1 Update `README.md` architecture section
- [ ] 6.2 Update `CLAUDE.md` with provider-aware layering guidance

## 7. Verification

- [ ] 7.1 Run `npm run build`
- [ ] 7.2 Run `npm test`
- [ ] 7.3 Bump version if implementation lands
