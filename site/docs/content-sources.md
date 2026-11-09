# Production content sources

Local builds and timestamp formatting are unchanged: without `VAULT_ROOT` they use `.vault-data`; with it they use the selected local checkout. The settings below apply to GitHub Actions deployment.

## Website repository settings

Under **Settings > Secrets and variables > Actions > Variables**, optionally set:

| Variable               | Default                   | Purpose                                                                                 |
| ---------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| `CONTENT_REPOSITORY`   | This repository           | Content location as `owner/repository`, without a URL                                   |
| `CONTENT_BRANCH`       | `vault`                   | Production content branch, including names such as `notes/live`                         |
| `CONTENT_TEST_PROFILE` | Generic collection checks | Set `reference` only for the original English collection's full 120-test browser matrix |

This repository uses `CONTENT_TEST_PROFILE=reference`. Other sites do not need to copy that setting. All builds retain publication validation, type checks, build/output audits, and browser checks; generic checks discover the actual collection rather than requiring named original articles.

The production checkout must contain `vault/notes/` and optionally `vault/assets/`, regardless of its repository or branch name. Website code always comes from the website repository's default branch; Pages deployment remains in that repository.

When the configured repository is accessible but its branch returns a confirmed 404, the workflow uses the **pinned `.vault-data` commit**, repository URL, and branch recorded by `.gitmodules`. It never repairs or pushes this sample fallback. The default sample verification job still runs independently before deployment.

Missing/inaccessible repositories, bad credentials, API rate limits, server/network errors, invalid notes, and failed Git checkouts stop the run. They do not silently deploy sample content. In particular, a private repository reported as 404 is not treated as a missing branch.

The manual **Run workflow** form also offers one-run repository/branch overrides and a **Deploy** switch. Overrides do not modify repository variables. Disable Deploy for a validation-only run; the sample and selected-content jobs still run but Pages is untouched. Same-repository production timestamp repair can still push during such a run.

## Same repository, any production branch name

Set `CONTENT_BRANCH` if the name is not `vault`. Put the caller from `site/workflows/vault-publish.yml` at `.github/workflows/publish.yml` **on that content branch**, and keep its source copy on the website branch synchronized. Its push listener covers branch names broadly, while the job runs only for the configured production branch. Keep the reusable `uses:` reference pointing to your website repository's workflow on main.

The selected branch is passed explicitly to timestamp repair, so repairs push back to that branch, not always vault. Permit that branch in the `github-pages` environment and in applicable branch rules. The workflow token needs `contents: write` for these repairs.

## External content repository

On the **website repository**, set `CONTENT_REPOSITORY` and `CONTENT_BRANCH`. Public content can be read with the default token. For private content, add a **`CONTENT_TOKEN` secret** with metadata/contents read access to that content repository. A suitably scoped GitHub App installation token or fine-grained PAT can supply access. The website build does not push into an external repository: it can fill missing dates in its disposable checkout, but remote repair belongs to the notifier below.

On the **content repository**, copy `site/workflows/external-content-publish.yml` to `.github/workflows/publish.yml`. Configure:

| Setting                         | Purpose                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Variable `WEBSITE_REPOSITORY`   | Required target `owner/website-repository`                                              |
| Variable `WEBSITE_BRANCH`       | Website workflow/tooling ref; defaults to `main` (normally the website default branch)  |
| Variable `WEBSITE_WORKFLOW`     | Defaults to `pages.yml`                                                                 |
| Variable `CONTENT_BRANCH`       | Branch to publish; defaults to the content repository's default branch                  |
| Secret `WEBSITE_DISPATCH_TOKEN` | Token with **Actions write** access to the website repository                           |
| Secret `WEBSITE_CODE_TOKEN`     | Only needed when the website code is private; token with **Contents read** access there |

Match the branch configured on both sides. The notifier uses its own `GITHUB_TOKEN` with Contents write to repair timestamps in the content repository, validates publication, pushes the repairs, and only then dispatches the website workflow. Its website-dispatch credential is separate from its content-write credential. Tokens are never committed to either repository.

Allow the bot's ordinary push under content branch protection. Repair commits made with that repository's `GITHUB_TOKEN` do not trigger another push workflow; the notifier additionally skips its known repair commit subject. Failed repair or validation prevents notification. If notification fails, rerun it after fixing access; repair is idempotent.

The notification sends no content-source override. The website repository's own configuration remains authoritative. A workflow dispatch runs on the chosen website branch, so deployment uses the website's Pages environment, not the content repository's environment.

Keep `WEBSITE_BRANCH` aligned with the website's default branch: the notifier reads tools from that ref, and the website build always checks out code from its default branch. GitHub documents the required [Actions write permission for workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) and why [token-authored repair pushes do not start another push run](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

For an external setup, use this notifier rather than calling the shared Pages workflow directly with `jobs.publish.uses`: a reusable workflow runs in its caller's repository context. The existing reusable caller remains supported for branches in the same repository.

## Verification

`tests/content-source.test.mjs` uses independent Git repositories and remotes to exercise same-repository defaults, an external repository with a custom branch, and pinned sample fallback. It builds all three through the real builder and verifies repair targets, existing-date preservation, authenticated dispatch payloads, and failures that must not trigger fallback. These tests run locally and in GitHub Actions. No external production source or credential is required to run the fixtures.

For the original collection locally, use `VAULT_ROOT=/path/to/english-vault SITE_TEST_PROFILE=reference npm test`. For a different collection, `VAULT_ROOT=/path/to/content npm test` uses generic browser checks by default. The bundled starter is selected automatically by its sample marker unless a test profile is explicitly set.
