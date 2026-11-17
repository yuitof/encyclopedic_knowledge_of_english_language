# Service bridge

The `service-bridge` branch contains the AWS Lambda service that exposes a private, session-authenticated CONNECT proxy over Tailscale.

- [Server implementation, deployment, and verification](infra/service-bridge/README.md)
- Lambda build context and CloudFormation templates: `infra/service-bridge/`
- Server tests: `tests/service_bridge/`

The Codex Cloud client, YouTube collection tooling, private-cache infrastructure, and English vault are maintained separately on the repository's [`vault` branch](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/tree/vault). The client uses Codex Cloud's built-in Tailscale VPN to reach this service.

Run the offline tests with Python dependencies from `infra/service-bridge/requirements.txt` installed:

```bash
python -m unittest discover -s tests/service_bridge -v
```

Build the Lambda image independently of the client:

```bash
docker build --platform linux/amd64 --provenance=false -f infra/service-bridge/Dockerfile -t service-bridge:test infra/service-bridge
```

Deployment uses the existing enrollment secret ARN and scoped Cloud runtime role; see the server guide. Deployment and live probes are separate from offline tests. Private runtime data stays under ignored `.codex/tmp/` and must not enter commits or build images.

The previous server branch is retained as [`archive/service-bridge`](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/tree/archive/service-bridge). AWS resource names remain `service-bridge`.
