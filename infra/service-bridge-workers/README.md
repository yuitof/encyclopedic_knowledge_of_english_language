# Workers bridge feasibility deployment

The Worker offers private fixed-target egress and signed-out caption diagnostics, a signed-out caption relay for any valid public YouTube video ID, and fixed read-only X and Reddit operations. The checked-in Wrangler configuration publishes neither a production nor a preview URL and leaves diagnostics, caption relay, and social relay disabled. `GET /v1/health` is inert. Access enforcement is at the Cloudflare edge and must pass production and preview checks before enabling routes.

[Feasibility and evidence](FEASIBILITY.md) · [HTTPS contract](API.md) · [Proposed vault integration](VAULT-INTEGRATION.md)

## Local verification

Use Node 22.12+, 24, or 26+ and Terraform 1.7+. From this directory:

```sh
npm ci
npm run check
npm test
npm run build
terraform -chdir=terraform fmt -check
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
terraform -chdir=terraform plan -input=false -refresh=false -var-file=account.tfvars.example
```

The example plan uses placeholder IDs. Keep it separate from the account-scoped plan. The Vitest plugin disables remote bindings and runs against local workerd with synthetic inputs. The Wrangler build is a dry run.

## Read-only account review

Provide the target account ID via `CLOUDFLARE_ACCOUNT_ID` and an account-scoped read-only token via `CLOUDFLARE_API_TOKEN`. Use Workers metadata read, Access Apps and Policies read, and Zero Trust/Gateway read permissions. Run `npm run inspect` privately. It prints the matching Worker and its route status, selected Access applications, TLS decryption flags, and enabled Gateway rule types and actions.

In the dashboard, review the existing Worker-level, account-wide and overlapping hostname Access applications and policies, the existing workers.dev subdomain, and Gateway DNS/network/HTTP/egress rules. Check for private hostname routes and DNS overrides of the approved origins, existing Forward policies that might match Workers VPC, TLS inspection, allowed traffic logging, and the account's available log fields and retention. Inspect privately using read privileges. If the dedicated Worker or Access app already exists, verify ownership and approved configuration before deciding whether to import that exact resource. Use a fresh Terraform state for this service. Leave unrelated resources outside it.

## Approval and deployment sequence

1. Approve deploying `service-bridge-workers` with the checked-in settings and the existing default virtual network. Set `CLOUDFLARE_ACCOUNT_ID` and provide a separate account-scoped Workers Scripts Write token through `CLOUDFLARE_API_TOKEN`, preferably an individual Worker editor after creation if the account supports it. From this directory, run `npx wrangler deploy`. Record the initial deployment ID privately. Fetch the stable Worker ID from `npm run inspect` after switching back to read credentials.
2. Generate the actual Terraform plan with the verified account and stable Worker IDs. Review it before requesting approval to apply. Proposed scope is a dedicated seven-day service token and a dedicated self-hosted Access app with one Service Auth rule for that exact token and a `worker` destination covering the Worker. The plan should create only those two resources. Gateway and unrelated account configuration are outside the plan.
3. After apply approval, use a separate token scoped to the selected account with Access Apps and Policies Write and Access Service Tokens Write. Apply the reviewed plan. Transfer the generated client ID and secret directly to private configuration. Keep Access enabled for the lifetime of any exposed release.
4. With approval, deploy from a private local copy of `wrangler.jsonc` in this directory with `workers_dev` and `preview_urls` set to `true` and diagnostics still disabled. Name the copy `wrangler.acceptance.local.jsonc` so Git ignores it. Use `npx wrangler deploy --config wrangler.acceptance.local.jsonc` and obtain the exact production URL and one exact version preview URL. Verify Access on both using the script below. Confirm there are no other bindings or routes to this Worker. An existing approved workers.dev account subdomain is required for this runbook. If it is missing, request separate authorization for the proposed hostname arrangement.
5. After edge Access checks pass, with approval enable `DIAGNOSTICS_ENABLED` in the private deployment configuration and deploy. Re-run Access checks against the new release and its preview before probes. If coverage fails, redeploy the checked-in disabled configuration immediately under the approved rollback. Disable previews after acceptance. Enable diagnostics only in an approved acceptance window. The client-controlled caption relay has its own `COMPARISON_ENABLED` switch. The X/Reddit relay has a separate `RELAY_ENABLED` switch. Use [the signed-out caption API](API.md#signed-out-caption-relay) and [fixed social operations](API.md#read-only-x-and-reddit-relay) only after confirming Access.
6. Run the egress diagnostics and correlate Gateway logs before calling the caption endpoint. If either route fails, inspect the actual error and corresponding Gateway evidence. Resolve any policy issue with a separately reviewed proposal before proceeding. Account-wide Gateway configuration or policy changes need separate approval.

### Private Terraform state

Use an isolated encrypted backend with locking and restricted access for an ongoing deployment. For a local evaluation, use an encrypted local directory outside the repository, mode 0700, with `umask 077`. Terraform variables, saved plan and state should all live there. Both state and plan may contain credentials regardless of CLI redaction. Do not enable Terraform debug tracing.

```sh
terraform -chdir=terraform plan -input=false \
  -state="$BRIDGE_STATE_DIR/terraform.tfstate" \
  -var-file="$BRIDGE_STATE_DIR/account.tfvars" \
  -out="$BRIDGE_STATE_DIR/access.tfplan"
terraform -chdir=terraform show -no-color "$BRIDGE_STATE_DIR/access.tfplan"
# Only after the account-specific plan is approved:
terraform -chdir=terraform apply -input=false \
  -state="$BRIDGE_STATE_DIR/terraform.tfstate" "$BRIDGE_STATE_DIR/access.tfplan"
```

Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` through a secret manager or a private shell using Terraform's sensitive outputs. Avoid echoing or logging them. To rotate with overlap, create a replacement token resource, temporarily authorize its exact ID alongside the old ID, verify the replacement, and remove the original policy include and token through a reviewed plan. When testing expired or revoked credentials, use a disposable authorized test token, save it privately and confirm that it receives an edge denial after expiration or revocation on both routes. Review those token/policy changes separately.

## Live evidence

Set `SERVICE_BRIDGE_WORKER_URL`, `SERVICE_BRIDGE_WORKER_PREVIEW_URL`, and the two private Access credentials. Use approved exact workers.dev hostnames. The script verifies TLS, disables redirects, and reports status and Worker reachability. For older organizations an Access denial may redirect to the login page, so the script records 302 without following it. The Worker must return its version marker only for a valid service-token request.

```sh
npm run acceptance -- access
npm run acceptance -- egress
# After egress and corresponding Gateway log rows have been verified:
npm run acceptance -- captions
```

Record exact UTC timestamps, the two observed public IPs, Worker deployment IDs, and the Gateway log evidence privately. Look under Zero Trust → Insights & Logs → Logs → Network logs. Enable the Traffic Source column in the UI and correlate **Workers VPC** with the destination and UTC window. Where available, confirm `OnrampType=WORKERS_VPC`, `SourceName=service-bridge-workers`, public origin IP/port, and the off-ramp in Network Session Logs. Check DNS and HTTP policy actions when present. The IP observation alone cannot attribute the route. Verify Access denial on both surfaces with missing and invalid credentials. Test expired and revoked credentials separately as described above.

To verify reachability from Codex Cloud, run the standalone script in the actual Cloud executor using the approved hostname and existing HTTPS proxy/CA settings. With a Node release that supports it, set `NODE_USE_ENV_PROXY=1` for the command so `fetch` respects `HTTPS_PROXY` and `NO_PROXY`. Use the existing trusted CA configuration where needed. An exact-hostname CONNECT denial before origin TLS is a Cloud route issue. Request approval for an exact-host grant if needed. No changes to Cloud variables or published snapshots are required by this checkout.

## Rollback and cleanup

First redeploy the checked-in configuration or restore the known diagnostics-disabled version and explicitly verify that both public surfaces and preview URLs are disabled. Keep Access in place during shutdown. After confirming the Worker is unreachable, separately approve a reviewed removal plan for the dedicated app and token and deletion of the dedicated Worker, if desired. Remove private client credentials and handle state/backups under the existing secret-retention policy. The Lambda bridge remains available via its existing independent path.
