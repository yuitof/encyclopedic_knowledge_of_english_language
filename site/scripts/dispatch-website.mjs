import path from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryName, branchName } from "./content-source.mjs";

export async function dispatchWebsite({
  repository,
  branch = "main",
  workflow = "pages.yml",
  token,
  apiUrl = "https://api.github.com",
  request = fetch,
}) {
  repositoryName(repository);
  branchName(branch);
  if (!/^[A-Za-z0-9_.-]+\.ya?ml$/u.test(workflow))
    throw new Error("Website workflow must be a YAML filename");
  if (!token)
    throw new Error(
      "WEBSITE_DISPATCH_TOKEN is required to notify the website repository",
    );
  const response = await request(
    `${apiUrl}/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // The website's settings choose the content source. The notifier cannot override it.
      body: JSON.stringify({ ref: branch }),
    },
  );
  if (response.status !== 204)
    throw new Error(
      `Website dispatch failed (HTTP ${response.status}); check the target workflow and Actions write permission`,
    );
  return { repository, branch, workflow };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await dispatchWebsite({
    repository: process.env.WEBSITE_REPOSITORY,
    branch: process.env.WEBSITE_BRANCH || "main",
    workflow: process.env.WEBSITE_WORKFLOW || "pages.yml",
    token: process.env.WEBSITE_DISPATCH_TOKEN,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });
  console.log(
    `Notified ${result.repository}: ${result.workflow}@${result.branch}`,
  );
}
