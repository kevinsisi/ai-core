---
name: deployment and release process
description: How to build, version, tag, and publish @kevinsisi/ai-core to GitHub Packages
type: reference
---

**Registry:** GitHub Packages — `https://npm.pkg.github.com/@kevinsisi`

**Publish trigger:** GitHub Actions on `refs/tags/v*` push only (not on every main push)

**Release steps:**
1. Bump version in `package.json` (semver)
2. `npm run build` — updates `dist/`
3. Commit: include both `src/` changes and updated `dist/`
4. `git tag vX.Y.Z && git push && git push --tags`
5. CI publishes automatically

**Consumer installation:**
```jsonc
// Via git ref (no registry auth needed for public repo):
"@kevinsisi/ai-core": "github:kevinsisi/ai-core#vX.Y.Z"

// Via npm registry (requires .npmrc with auth token):
"@kevinsisi/ai-core": "^X.Y.Z"
```

**Consumer .npmrc requirement:**
```
@kevinsisi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```
