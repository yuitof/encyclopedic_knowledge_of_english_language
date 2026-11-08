# Proposed automatic Pages trigger — approval pending

The requested automatic publication on remote `main` commits is fully specified below, but **has not been applied**. The current workflow remains manual. Automatic approval review rejected enabling future public deployment twice, citing the original requirement for explicit public-deployment approval; no push, merge, Actions run or deployment was attempted.

Approve this local configuration change to make future pushes to `main` trigger the existing guarded build/deploy jobs:

```diff
 on:
+  push:
+    branches: [main]
   workflow_dispatch:
```

Both existing job guards remain unchanged:

```yaml
if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch) && github.ref != 'refs/heads/feature/quartz-wiki'
```

The feature branch cannot deploy. The repository's current production/default branch is `main`; adjust the trigger if that branch is renamed. Existing Pages permissions, environment protection, reproducible dependency installation, tests, audited build and official artifact/deploy Actions stay in place. Applying the configuration does not itself push or execute deployment; it enables automatic publication for a later authorized remote `main` push.
