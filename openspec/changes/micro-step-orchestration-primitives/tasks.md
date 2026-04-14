## 1. Step Orchestration Types

- [ ] 1.1 Add typed step-definition and execution-metadata interfaces
- [ ] 1.2 Add explicit preferred-key and shared-fallback semantics to the type model

## 2. Core Orchestration Primitives

- [ ] 2.1 Add a reusable step-runner module for quota-sensitive workflows
- [ ] 2.2 Add preferred-key planning helper(s)
- [ ] 2.3 Add reusable lease-heartbeat helper(s) for long-running step execution
- [ ] 2.4 Ensure `NoAvailableKeyError` contract remains strict when no true fallback exists

## 3. Execution Metadata

- [ ] 3.1 Return structured metadata for each step run (key choice, fallback, retry count, duration)
- [ ] 3.2 Expose the metadata through public types so consumers can log and assert behavior

## 4. Public Exports

- [ ] 4.1 Add new export path(s) for step orchestration in `src/index.ts`
- [ ] 4.2 Add package export entry in `package.json`
- [ ] 4.3 Add build entry to `tsup.config.ts`

## 5. Tests

- [ ] 5.1 Test preferred-key planning when healthy key count >= step count
- [ ] 5.2 Test explicit shared fallback when healthy key count < step count
- [ ] 5.3 Test lease heartbeat lifecycle and cleanup
- [ ] 5.4 Test execution metadata contents

## 6. Docs

- [ ] 6.1 Update `README.md` with step-orchestration usage guidance
- [ ] 6.2 Update `CLAUDE.md` with layering guidance for what belongs in ai-core vs consumer repos

## 7. Version & Verification

- [ ] 7.1 Bump version in `package.json`
- [ ] 7.2 Run `npm run build`
- [ ] 7.3 Run `npm test`
- [ ] 7.4 Review diff and stage regenerated `dist/`
