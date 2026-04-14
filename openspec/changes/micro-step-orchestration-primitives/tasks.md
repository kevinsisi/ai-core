## 1. Step Orchestration Types

- [x] 1.1 Add typed step-definition and execution-metadata interfaces
- [x] 1.2 Add explicit preferred-key and shared-fallback semantics to the type model

## 2. Core Orchestration Primitives

- [x] 2.1 Add a reusable step-runner module for quota-sensitive workflows
- [x] 2.2 Add preferred-key planning helper(s)
- [x] 2.3 Add reusable lease-heartbeat helper(s) for long-running step execution
- [x] 2.4 Ensure `NoAvailableKeyError` contract remains strict when no true fallback exists

## 3. Execution Metadata

- [x] 3.1 Return structured metadata for each step run (key choice, fallback, retry count, duration)
- [x] 3.2 Expose the metadata through public types so consumers can log and assert behavior

## 4. Public Exports

- [x] 4.1 Add new export path(s) for step orchestration in `src/index.ts`
- [x] 4.2 Add package export entry in `package.json`
- [x] 4.3 Add build entry to `tsup.config.ts`

## 5. Tests

- [x] 5.1 Test preferred-key planning when healthy key count >= step count
- [x] 5.2 Test explicit shared fallback when healthy key count < step count
- [x] 5.3 Test lease heartbeat lifecycle and cleanup
- [x] 5.4 Test execution metadata contents

## 6. Docs

- [x] 6.1 Update `README.md` with step-orchestration usage guidance
- [x] 6.2 Update `CLAUDE.md` with layering guidance for what belongs in ai-core vs consumer repos

## 7. Version & Verification

- [x] 7.1 Bump version in `package.json`
- [x] 7.2 Run `npm run build`
- [x] 7.3 Run `npm test`
- [x] 7.4 Review diff and stage regenerated `dist/`
