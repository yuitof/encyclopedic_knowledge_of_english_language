# Automatic GitHub Pages deployment

The user explicitly authorized automatic publication when the project is pushed to `main`. The earlier proposal is now implemented in `.github/workflows/pages.yml`:

```yaml
on:
  push:
    branches:
      - main
  workflow_dispatch:
```

Every push to `main`, including a merged pull request, runs the existing dependency installation, publication/privacy checks, TypeScript, fixture and browser tests, production build and output audit. Only a successful build proceeds to artifact upload and deployment. Other branches do not trigger a push deployment, and both jobs retain their default-branch guard.

Keep `main` as the GitHub default branch and **Settings → Pages → Source** set to **GitHub Actions**. Existing environment protections still apply. Manual deployment remains available in **Actions → Build and deploy English Encyclopedia → Run workflow**.

This configuration takes effect once committed and pushed to GitHub; that push also triggers the first automatic run. The generated `site/public` artifact remains ignored and is built in Actions. Node 24, the official Pages Actions, permissions, tests and explicit content-selection policy are unchanged.
