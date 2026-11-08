# Automatic GitHub Pages deployment

Implemented: pushes to `main` and `vault` build and deploy through the shared workflow on main. The data branch's small caller invokes it, with permissions to repair timestamps and publish the artifact.

See [publication.md](publication.md) for branch layout, bot commits, validation and retry behavior, and [the site README](../README.md) for local setup. Keep Pages configured to use GitHub Actions. Existing environment and branch protections continue to apply.
