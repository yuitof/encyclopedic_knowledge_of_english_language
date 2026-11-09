# Sample vault

This branch is the small starter collection pinned by `main`'s `.vault-data` submodule. It has its own fresh history and contains example notes, an image, a template, and shared Obsidian timestamp-plugin settings. The same repository's other branches and history can still contain the full collection: this is not a privacy boundary.

Open `vault/` in Obsidian. If desired, review and exit Restricted mode under Settings > Community plugins, then enable **Update modified date**. Its shared settings use `created` and `modified`, typing-only updates, a 10-second delay, and single timestamp values. The upstream MIT license is included beside the plugin; release checksums are recorded in `obsidian-plugins.json`.

## Local use

A recursive clone of the website checks out this sample at the recorded revision. Without `VAULT_ROOT`, local builds and the timestamp formatter use `.vault-data`. Templates under `vault/templates/` are not published.

Keep your live notes in a separate checkout of the `vault` branch. From the website's `site/` folder, set `VAULT_ROOT=/absolute/path/to/live-checkout` when building or formatting the live notes. The path must contain `vault/notes/`.

## Deploy your own copy

In your own repository, create `vault` from this branch (`git switch -c vault`, then `git push origin vault`). The site workflow on `main` deploys the latest `vault` branch, even though `.vault-data` pins `sample-vault` locally.

Copy `site/workflows/vault-publish.yml` from `main` into `.github/workflows/publish.yml` on your new `vault` branch. Update its reusable-workflow reference to your repository, and keep its source copy on `main` synchronized. Update `.gitmodules` to your repository URL and configure GitHub Pages/Actions as described in the wiki. This sample branch intentionally contains no publication workflow.

## Maintaining the sample

Improve examples on `sample-vault`, then deliberately update and commit the website's submodule pin. Keep actual collection work on `vault`. Original sample text uses the repository's CC BY-SA 4.0 license; third-party software retains its own license.
