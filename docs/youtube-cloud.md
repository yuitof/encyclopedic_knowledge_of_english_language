# YouTube notes with a private S3 cache

The selected design uses a **private S3 cache in us-west-1**, provisioned by [CloudFormation](../infra/youtube-cache/README.md). New Cloud tasks restore the history index and lazily download the needed transcripts, reusing them before making caption API calls. Local working files remain in the ignored cache. The scripts do not automatically write notes: Codex verifies the occurrence, researches its dictionary sense, and edits notes following `AGENTS.md`.

**Status:** 28 offline tests pass. CloudFormation deployed `english-vault-youtube-cache` in `us-west-1`; the existing 750-video history index and 652 transcripts were seeded into private S3. An isolated empty local cache restored the index and a transcript with the caption API disabled. Bucket privacy/encryption/versioning were checked live. Normal Chrome cookie export and an isolated local history refresh succeeded, with complete account-feed coverage for 2026-10-17 through 2026-11-16 in Europe/London, saved to S3. The private Cloud draft has the bucket variable, scoped AWS OIDC connection, installation/startup instructions, time zone, and 13-host restricted allowlist. The Cloud VM recovered: installation, 28/28 tests, headless Chromium, STS identity, and allowed/denied S3 metadata checks passed. Cloud YouTube access currently fails with a proxy CONNECT HTTP 403 despite the saved host allowlist; diagnosis is pending. The personal cookie requirement is declared without a value, and the environment remains unpublished until that blocker is resolved. GitHub and AWS authorization do not authenticate a Google session.

## What belongs where

| Tracked in GitHub | Private, ignored task files |
| --- | --- |
| `AGENTS.md`, this guide, scripts, synthetic tests, dependency pins | `.codex/tmp/youtube/history.json` |
| Requested notes with short quotations and source links | `.codex/tmp/youtube/transcripts/*.json` |
| | `.codex/tmp/youtube/auth/storage-state.json` |
| | Virtual environment, browser downloads, runtime versions, search results |

The existing local cache is retained; setup does not upload, replace, or rebuild it. History and transcripts never go into GitHub Actions artifacts, issues, PR bodies, or releases. Keep session values out of task prompts, logs, and Git. `gitignore` only helps with untracked files; always inspect the actual staged paths.

Each Cloud task has separate working files. A published environment is a starting snapshot, not a shared writable cache. S3 supplies cross-task persistence: configure the same `YOUTUBE_CACHE_BUCKET` and a scoped AWS identity in each task. The history index merges video watches using conditional writes so simultaneous tasks cannot silently overwrite each other's additions. Transcripts use immutable content-addressed keys. Local progress is retained if S3 fails, but that progress is not durable until synchronization succeeds. Runtime cookies are never included in S3 synchronization.

Deploy with `bash infra/youtube-cache/deploy.sh`, then run `bash tools/youtube/run.sh sync` on the local Mac to seed existing history/transcripts. See the infrastructure guide for scoped OIDC access, recreation, privacy checks, and recovery. Do not use `aws s3 sync .codex/tmp/youtube/ ...`: it would copy authentication and browser files too.

## One-time Cloud environment setup

1. Make the workflow commit available on GitHub's **vault** branch, or select a task branch based on `vault`. Do not select or merge the website's `main` branch.
2. In **Settings → Codex Cloud → Environments → Create environment**, select `yuitof/encyclopedic_knowledge_of_english_language` and keep the environment **Only me**. Repository access does not provide YouTube access.
3. Use Python 3.12 or newer. During setup, run:

   ```bash
   bash tools/youtube/setup.sh
   .codex/tmp/youtube/.venv/bin/python -m unittest discover -s tests/youtube -v
   bash tools/youtube/run.sh --help
   ```

   The script installs workflow dependencies into the ignored virtual environment and Chromium into the ignored browser directory. If Chromium reports missing Linux system libraries, run `PLAYWRIGHT_BROWSERS_PATH="$PWD/.codex/tmp/youtube/browsers" .codex/tmp/youtube/.venv/bin/python -m playwright install --with-deps chromium` during environment setup. No Node or website dependencies are changed.

4. Set `YOUTUBE_TIMEZONE=Europe/London` as an environment variable. Change it if another time zone should define your watch days. The history feed exposes day labels, not precise timestamps. The script sets browser locale to English and browser time zone to this value; compare a known recent video/day during the live check because YouTube's server/account date grouping can differ.
5. Enable **Package managers** and allow the hosts actually required by the workflow: `www.youtube.com`, `youtube.com`, `www.google.com`, `accounts.google.com`, and the Chromium download hosts `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`. Add the dictionaries you use, such as `www.merriam-webster.com`, `www.oxfordlearnersdictionaries.com`, `www.ldoceonline.com`, `www.britannica.com`, and `dictionary.cambridge.org`. Add further redirect/download hosts only when an actual failure identifies them. History continuations and caption retrieval need HTTPS POST as well as GET. For legacy environments, allow these methods in agent internet settings too.
6. Set `YOUTUBE_CACHE_BUCKET` to the CloudFormation `BucketName` output. Attach a scoped AWS OIDC connection using **Advanced → OIDC**, and permit the exact `BucketEndpoint` output and `sts.us-west-1.amazonaws.com` in the restricted network policy. The stack's `CacheAccessPolicyArn` permits only cache-object reads/writes, not deletes, listing arbitrary objects, or writing session files. Use the optional exact OIDC trust parameters in the template once the connection's issuer/audience/subject are known. Never give Cloud the local administrator's AWS access keys. OIDC and S3 access still require a live Cloud check.
7. Save and publish the environment **without a saved session or copied history/transcripts in the prepared filesystem**. Installation tests must use synthetic data; do not restore S3 private data into the reusable setup snapshot. Supply the personal YouTube session only to a private runtime task. If an environment is ever shared, recheck personal-secret scope and prepared files first.
8. In a runtime task, run the live checks below. New tasks may share the S3 cache; each still needs authorized YouTube and AWS access.

Environment setup prompt (after the workflow is on the selected GitHub branch):

> Set up this repository's vault branch using docs/youtube-cloud.md and AGENTS.md. Run bash tools/youtube/setup.sh, the offline tests, and CLI --help. Keep the environment private. Use Europe/London for watch dates. During reusable setup do not restore private S3 data, run doctor with a configured bucket, collect history, fetch transcripts, or publish private session files into the environment snapshot. Ask me to supply my YouTube session privately to the runtime task if it is missing. Report the tested environment configuration before publishing.

Current Cloud settings are managed in the app/web UI, not by a repository `config.toml`. This project does not add a pretend Cloud configuration file. In legacy Codex Cloud, use `bash tools/youtube/setup.sh` as the setup script; use it as maintenance only when dependencies need rebuilding, not on every search. Legacy setup-only secrets disappear before the agent runs, so they are not a usable runtime authentication source by themselves. Do not work around that by writing them into tracked files or shell startup files.

## YouTube authentication: separate from GitHub

The YouTube Data API does **not** return your watch-history items. The workflow reads the signed-in account history feed at `https://www.youtube.com/feed/history`, including continuation responses. This is a website integration, not an official watch-history API. Layout/API changes, account consent screens, bot challenges, expired cookies, and cloud IP blocks can stop it. Login transfer can be rejected by Google; do not promise unattended permanent access.

The user must authorize and provide a YouTube session. A session is sensitive: anyone with usable cookies may act as that account. Sign in normally to YouTube in Chrome first. Prefer a separate Chrome profile for this workflow; select its exact name using `--profile 'Profile N'`. The helper reads a Chrome profile only after explicit authorization and only saves YouTube-domain cookies. Local, user-driven setup:

```bash
bash tools/youtube/setup.sh
bash tools/youtube/run.sh login
```

`login` asks before reading Chrome's `Default` cookie database. The optional local-only `yt-dlp` dependency is installed in the ignored virtual environment when needed. It reads/decrypts browser cookies locally, retains only unexpired YouTube cookies, and saves them under `.codex/tmp/youtube/auth/storage-state.json` with private permissions. It does not save other domains' cookies or browser local storage. Chrome's HttpOnly and SameSite attributes are read from its database rather than guessed. Temporary database copies stay in the ignored cache and are cleaned up by the extractor. A macOS Keychain prompt may require the user to approve access. An agent may use `--authorize-export` only after the user has explicitly authorized this profile's export. Nothing is printed or uploaded by login. The session is only used for history; public caption requests use a separate signed-out client.

If Google says “This browser or app may not be secure,” close the old automated Chromium login window. Do not disable checks or retry with stealth flags. The replacement helper uses your normally signed-in Chrome profile and does not automate Google sign-in. Close and reopen the normal Chrome profile or check its selected account if it contains no signed-in YouTube cookies. Cookie transfer can still expire or be refused by YouTube; only a live history check establishes it works.

To supply it to Cloud, use a **personal, selected-environment direct variable** named `YOUTUBE_STORAGE_STATE_JSON`, containing the JSON from that private file, through Codex's private settings UI. Alternatively, securely transfer the file directly to the running private task at the ignored path if that Cloud surface supports private file transfer. Do not paste it in conversation or upload it to GitHub. The login command does not transfer anything automatically.

The cookie JSON must reach the process as real JSON. A network-secret placeholder is not suitable here: Playwright parses cookies and supplies them to its browser locally, so proxy substitution of an opaque placeholder will not work. Do not treat the JSON as a non-sensitive shared environment variable. If private per-user direct variables or secure file transfer are unavailable in your surface, stop and resolve private delivery rather than putting cookies in source control or chat. Authentication may need renewal; rerun local login and replace the private value when required.

The browser visits only the authenticated history feed. It does not play watched videos. For manual video verification, use a separate signed-out private session. Do not let an authenticated verification visit add a new item to watch history.

## Live acceptance checks in the ongoing Cloud task

```bash
bash tools/youtube/run.sh doctor
bash tools/youtube/run.sh refresh
bash tools/youtube/run.sh search 'YOUR PHRASE' --day yesterday
bash tools/youtube/run.sh search 'YOUR PHRASE' --day yesterday --fetch
```

Check that `refresh` reports `range_complete: true`, the configured time zone, and a sensible date range. Compare one known watch date against your actual history. The first refresh attempts the preceding 30 days; later successful refreshes overlap the last refresh day. Use `refresh --since YYYY-MM-DD` for an older requested range. A page cap, unknown date headings, or stalled history loading is reported as incomplete, with gathered progress saved. Reaching the end of a short feed is currently treated conservatively as incomplete unless an older-than-cutoff section loads; do not infer full coverage from that failure.

The history feed cannot recover deleted or paused history, exact watch times, or repeats within the same day. Browser visits in the old local index remain separate and are not counted as account watches by the date filter.

After the first successful caption fetch, repeat the search without `--fetch`, then with `--fetch`. A valid cache hit is read locally or downloaded from private S3 before constructing a caption API client. Repeat in a new task configured for the same bucket to check cross-task reuse. `doctor` restores S3 index metadata and validates local cached files; it does not bulk-download remote-only transcripts or call YouTube. It never prints credentials.

The transcript library documents frequent cloud IP blocking. Such failures are `retry_needed`, not proof captions are unavailable. `search ... --fetch --retry` retries temporary failures; confirmed unavailable captions are skipped. `YOUTUBE_TRANSCRIPT_PROXY` optionally accepts an already authorized HTTP/HTTPS proxy URL; the workflow does not buy or provision one. Proxy access is not a guarantee. Network failures are logged by exception type to avoid leaking proxy credentials. Do not silently send account cookies through a third-party transcript service.

## Subsequent natural-language requests

Use a private task configured for the **same S3 cache**, for example:

> Find “put aside” in yesterday's YouTube history and create or update its note.

Codex must refresh history, resolve yesterday in the configured time zone, search cached captions first, and fetch unchecked candidates if needed. Exact matches come before separate inflection searches. Matches can span adjacent caption segments. Search output includes context and source timestamps; expand to the actual full sentence, verify the wording where feasible, then use a dictionary to select the attested sense and IPA. Follow `AGENTS.md` for note formatting, links, preservation of existing content, quotation limits, and committing/pushing checked task changes to `vault` unless the user requests otherwise. Never push private data or unrelated commits. Do not add a duplicate example on repeated requests.

The scripts cache source **transcripts**, not Japanese translations. Notes remain English unless translations are explicitly requested. If a requested example cannot be verified, report the actual limitation instead of manufacturing a quotation or treating an unrelated public search result as watched history.

Run only one workflow command at a time: atomic replacement protects files from interrupted writes but does not coordinate concurrent writers. Do not run a second agent against the same cache while a command is writing it.

## Offline validation

```bash
.codex/tmp/youtube/.venv/bin/python -m unittest discover -s tests/youtube -v
bash -n tools/youtube/setup.sh tools/youtube/run.sh
python3 tools/youtube/youtube.py --help
```

Tests use synthetic data in isolated temporary directories. They cover history/date parsing, incremental merging, caption-boundary matching, malformed cache recovery, cache hits without caption API calls, and privacy boundaries. They do not authenticate to Google or prove that YouTube accepts Cloud traffic.

References: [current Cloud environment setup, personal values and saved task state](https://learn.chatgpt.com/docs/environments/cloud-environments), [legacy setup/secrets](https://learn.chatgpt.com/docs/environments/cloud-environment), [YouTube API history restrictions](https://developers.google.com/youtube/data/revision_history#september-15-2016), [transcript API usage and cloud IP blocks](https://github.com/jdepoix/youtube-transcript-api#working-around-ip-bans-requestblocked-or-ipblocked-exception).
