# Lambda service bridge

## Scope

- Work on `service-bridge` for the Lambda server. The Cloud client, YouTube workflow, cache infrastructure, notes, and website publishing belong on `vault` or `main`; do not merge those branches into this branch.
- Read `README.md` and `infra/service-bridge/README.md` before changing the service. Keep the Lambda self-contained in `infra/service-bridge/` with no imports from client code.
- Maintain compatibility with the documented `connect-v1` session contract. The `vault` client uses Codex Cloud's built-in VPN through `proxy:8088`; it must not launch a separate Tailscale daemon or retrieve a client enrollment key.

## Privacy and service boundaries

- Keep keys, credentials, session records, network identity metadata, logs, and runtime dependencies under ignored `.codex/tmp/`. Never print credentials or commit private runtime data. Do not inspect unrelated browser profiles or export cookies.
- The worker retrieves only its own Tailscale enrollment key through its AWS role. Preserve the private CONNECT service, session authentication, destination restrictions, origin TLS verification, bounded lifetime, and cleanup.
- Keep the Docker build context restricted to the allowlisted server files. Do not add website or GitHub Actions publishing to this branch.
- Use synthetic data for offline tests. Live acceptance may use an unsigned connectivity probe; do not collect watch history, transcripts, or YouTube session credentials merely to test the server.

## Validation and recording changes

- Run the relevant tests under `tests/service_bridge/` and check shell syntax for deployment-script changes. Build the container when build inputs change. Distinguish offline tests, deployed-handler checks, local tailnet acceptance, and built-in Cloud VPN acceptance.
- Preserve unrelated work. After checking the result, stage only task changes, inspect the staged diff and outgoing commits, then commit and push to `service-bridge` unless the user requests a different workflow. Never force-push or publish unrelated commits.
- Keep deployment and validation status accurate in `infra/service-bridge/README.md`. Do not infer Cloud connectivity from a successful local probe.
