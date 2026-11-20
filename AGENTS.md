# Cloudflare service bridge

- Develop the Cloudflare server on `service-bridge-workers` under `infra/service-bridge-workers/`. The `service-bridge` branch owns the separate Lambda implementation, and `vault` owns the application, collectors, and caches. Communicate through the documented HTTPS API.
- Read the [rollout procedure](infra/service-bridge-workers/README.md) and [feasibility report](infra/service-bridge-workers/FEASIBILITY.md) before live work. Obtain approval before deployment, Terraform apply, or any Access or Gateway changes. Keep secrets, plans, state, live logs, and account evidence private outside tracked files. Use synthetic data offline and signed-out requests for caption acceptance.
- Complete Access, Gateway, and signed-out YouTube acceptance before building the general relay. Keep previews and diagnostics disabled outside the approved acceptance window. Never fall back from the Gateway binding to ordinary egress.
- Stage only task changes, inspect the staged diff, and commit locally on this branch. Push, merge, client changes on `vault`, and Lambda changes require separate authorization.
