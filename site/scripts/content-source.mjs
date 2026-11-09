import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value ?? ""))
    throw new Error("Repository must be owner/repository, without a URL");
  return value;
}
export function branchName(value) {
  const result = spawnSync("git", ["check-ref-format", "--branch", value], {
    encoding: "utf8",
  });
  if (result.status !== 0 || value.startsWith("-") || value === "HEAD")
    throw new Error("Invalid content branch name");
  return value;
}
function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`Cannot read sample submodule: ${result.stderr}`);
  return result.stdout.trim();
}
export async function resolveContentSource({
  root,
  websiteRepository,
  contentRepository,
  contentBranch,
  token,
  websiteToken,
  apiUrl = "https://api.github.com",
  request = fetch,
}) {
  const website = repositoryName(websiteRepository);
  const repository = repositoryName(contentRepository || website);
  const branch = branchName(contentBranch || "vault");
  const accessToken =
    repository.toLowerCase() === website.toLowerCase()
      ? websiteToken || token
      : token;
  const headers = {
    Accept: "application/vnd.github+json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
  // A missing/inaccessible repository is an error, not an empty collection.
  const metadata = await request(`${apiUrl}/repos/${repository}`, { headers });
  if (!metadata.ok)
    throw new Error(
      `Cannot access content repository ${repository} (HTTP ${metadata.status}); check its name and credentials`,
    );
  const response = await request(
    `${apiUrl}/repos/${repository}/branches/${encodeURIComponent(branch)}`,
    { headers },
  );
  if (response.ok)
    return {
      mode: "production",
      repository,
      branch,
      ref: branch,
      same_repository: repository.toLowerCase() === website.toLowerCase(),
    };
  if (response.status !== 404)
    throw new Error(
      `Cannot inspect content branch ${branch} (HTTP ${response.status}); refusing sample fallback`,
    );
  // Fine-grained tokens can read repository metadata without reading contents.
  // Verify branch-list access so a masked permission 404 cannot deploy samples.
  const access = await request(
    `${apiUrl}/repos/${repository}/branches?per_page=1`,
    { headers },
  );
  if (!access.ok)
    throw new Error(
      `Cannot verify content branch access (HTTP ${access.status}); refusing sample fallback`,
    );
  const url = git(root, [
    "config",
    "-f",
    ".gitmodules",
    "--get",
    "submodule..vault-data.url",
  ]);
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/u.exec(
    url,
  );
  if (!match)
    throw new Error(
      "Sample submodule URL must be an HTTPS GitHub repository URL",
    );
  const sampleRepository = repositoryName(match[1]);
  const sampleBranch = branchName(
    git(root, [
      "config",
      "-f",
      ".gitmodules",
      "--get",
      "submodule..vault-data.branch",
    ]),
  );
  const ref = git(root, ["rev-parse", "HEAD:.vault-data"]);
  if (!/^[a-f0-9]{40}$/u.test(ref))
    throw new Error("Missing pinned sample submodule commit");
  return {
    mode: "sample",
    repository: sampleRepository,
    branch: sampleBranch,
    ref,
    same_repository: sampleRepository.toLowerCase() === website.toLowerCase(),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const source = await resolveContentSource({
    root: path.resolve(
      process.env.WEBSITE_ROOT ??
        path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    ),
    websiteRepository: process.env.GITHUB_REPOSITORY,
    contentRepository: process.env.CONTENT_REPOSITORY,
    contentBranch: process.env.CONTENT_BRANCH,
    token: process.env.CONTENT_TOKEN || process.env.GITHUB_TOKEN,
    websiteToken: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });
  console.log(
    `Content source: ${source.mode} ${source.repository}@${source.branch}${source.mode === "sample" ? ` (pinned ${source.ref})` : ""}`,
  );
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      Object.entries(source)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
}
