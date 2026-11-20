# Cloudflare service bridge

The `service-bridge-workers` branch develops a standalone Workers service using Cloudflare Access and Workers VPC Gateway egress. The current release contains the [feasibility Worker and rollout procedure](infra/service-bridge-workers/README.md).

- [Feasibility findings and test evidence](infra/service-bridge-workers/FEASIBILITY.md)
- [HTTPS diagnostics API and proposed relay contract](infra/service-bridge-workers/API.md)
- [Proposed collector integration](infra/service-bridge-workers/VAULT-INTEGRATION.md)

The AWS Lambda bridge remains independently maintained on the `service-bridge` branch and is not copied into this branch. Collectors and the private S3 caches live on `vault`. The Workers package builds independently of either branch.
