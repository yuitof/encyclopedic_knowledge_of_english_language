# YouTube notes in one Cloud Codex task

The selected design uses **one ongoing private Cloud task**, with no additional storage service. Reopen that task for each phrase request. The scripts fetch current account history and public English captions themselves; the ignored task-local cache reuses each video's transcript. They do not automatically write notes: Codex verifies the occurrence, researches its dictionary sense, and edits notes following `AGENTS.md`.

**Status:** 15 synthetic offline tests pass, along with shell syntax and Git whitespace checks. The workflow and Chromium installed successfully on the local Mac. A private Cloud environment draft now has installation/startup instructions, the watch-day time zone, and a restricted network allowlist. Installation in a Cloud VM, YouTube authentication, and live Cloud connectivity still need verification before this can be called operational. GitHub authorization does not authorize or authenticate a Google session.

## What belongs where

| Tracked in GitHub | Private, ignored task files |
| --- | --- |
| `AGENTS.md`, this guide, scripts, synthetic tests, dependency pins | `.codex/tmp/youtube/history.json` |
| Requested notes with short quotations and source links | `.codex/tmp/youtube/transcripts/*.json` |
| | `.codex/tmp/youtube/auth/storage-state.json` |
| | Virtual environment, browser downloads, runtime versions, search results |

The existing local cache is retained; setup does not upload, replace, or rebuild it. History and transcripts never go into GitHub Actions artifacts, issues, PR bodies, or releases. Keep session values out of task prompts, logs, and Git. `gitignore` only helps with untracked files; always inspect the actual staged paths.

Each Cloud task has separate working files. A published environment is a starting snapshot, not a shared writable cache. Resuming the same task reuses its saved files while they remain available; this is not a permanent backup. Current OpenAI documentation describes saved VM state as recoverable for up to seven days after the last turn or resume by default. A new task does not inherit the old task's newly fetched transcripts. Cross-task durable reuse would need private external storage, which the user chose not to add for now.

## One-time Cloud environment setup

1. Make the workflow commit available on GitHub's **vault** branch, or select a task branch based on `vault`. Do not select or merge the website's `main` branch.
2. In **Settings → Codex Cloud → Environments → Create environment**, select `yuitof/encyclopedic_knowledge_of_english_language` and keep the environment **Only me**. Repository access does not provide YouTube access.
3. Use Python 3.12 or newer. During setup, run:

   ```bash
   bash tools/youtube/setup.sh
   python3 -m unittest discover -s tests/youtube -v
   bash tools/youtube/run.sh doctor
   ```

   The script installs workflow dependencies into the ignored virtual environment and Chromium into the ignored browser directory. If Chromium reports missing Linux system libraries, run `PLAYWRIGHT_BROWSERS_PATH="$PWD/.codex/tmp/youtube/browsers" .codex/tmp/youtube/.venv/bin/python -m playwright install --with-deps chromium` during environment setup. No Node or website dependencies are changed.

4. Set `YOUTUBE_TIMEZONE=Europe/London` as an environment variable. Change it if another time zone should define your watch days. The history feed exposes day labels, not precise timestamps. The script sets browser locale to English and browser time zone to this value; compare a known recent video/day during the live check because YouTube's server/account date grouping can differ.
5. Enable **Package managers** and allow the hosts actually required by the workflow: `www.youtube.com`, `youtube.com`, `www.google.com`, `accounts.google.com`, and the Chromium download hosts `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`. Add the dictionaries you use, such as `www.merriam-webster.com`, `www.oxfordlearnersdictionaries.com`, `www.ldoceonline.com`, `www.britannica.com`, and `dictionary.cambridge.org`. Add further redirect/download hosts only when an actual failure identifies them. History continuations and caption retrieval need HTTPS POST as well as GET. For legacy environments, allow these methods in agent internet settings too.
6. Save and publish the environment **without a saved session or copied history/transcripts in the prepared filesystem**. Start one private task from it. Supply the personal session described below to the task; do not publish a reusable image containing it. If an environment is ever shared, recheck personal-secret scope and prepared files first.
7. In that task, run the live checks below. This is the task to reopen for future searches.

Environment setup prompt (after the workflow is on the selected GitHub branch):

> Set up this repository's vault branch using docs/youtube-cloud.md and AGENTS.md. Run bash tools/youtube/setup.sh, the offline tests, and doctor. Keep the environment private. Use Europe/London for watch dates. Do not collect history, fetch transcripts, or publish private session files into the environment snapshot. Ask me to supply my YouTube session privately if it is missing. Report the tested environment configuration before publishing.

Current Cloud settings are managed in the app/web UI, not by a repository `config.toml`. This project does not add a pretend Cloud configuration file. In legacy Codex Cloud, use `bash tools/youtube/setup.sh` as the setup script; use it as maintenance only when dependencies need rebuilding, not on every search. Legacy setup-only secrets disappear before the agent runs, so they are not a usable runtime authentication source by themselves. Do not work around that by writing them into tracked files or shell startup files.

## YouTube authentication: separate from GitHub

The YouTube Data API does **not** return your watch-history items. The workflow reads the signed-in account history feed at `https://www.youtube.com/feed/history`, including continuation responses. This is a website integration, not an official watch-history API. Layout/API changes, account consent screens, bot challenges, expired cookies, and cloud IP blocks can stop it. Login transfer can be rejected by Google; do not promise unattended permanent access.

The user must authorize and provide a YouTube session. A session is sensitive: anyone with usable cookies may act as that account. Prefer a separate browser session created for this task. The scripts never read your normal browser profiles. Local, user-driven setup:

```bash
bash tools/youtube/setup.sh
bash tools/youtube/run.sh login
```

Sign in yourself in the new browser and return to History. The terminal then saves only YouTube-domain cookies under `.codex/tmp/youtube/auth/storage-state.json`, with private permissions. It does not save other Google-domain cookies or browser local storage. The session is only used for the history feed; public caption requests use a separate signed-out client.

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

After the first successful caption fetch, repeat the search without `--fetch`, then with `--fetch`. A valid cache hit is read locally before constructing a caption API client. Resume this same task later and repeat to verify saved-file reuse. `doctor` validates cached transcript files without making network requests or printing credentials.

The transcript library documents frequent cloud IP blocking. Such failures are `retry_needed`, not proof captions are unavailable. `search ... --fetch --retry` retries temporary failures; confirmed unavailable captions are skipped. `YOUTUBE_TRANSCRIPT_PROXY` optionally accepts an already authorized HTTP/HTTPS proxy URL; the workflow does not buy or provision one. Proxy access is not a guarantee. Network failures are logged by exception type to avoid leaking proxy credentials. Do not silently send account cookies through a third-party transcript service.

## Subsequent natural-language requests

Return to the **same task**, for example:

> Find “put aside” in yesterday's YouTube history and create or update its note.

Codex must refresh history, resolve yesterday in the configured time zone, search cached captions first, and fetch unchecked candidates if needed. Exact matches come before separate inflection searches. Matches can span adjacent caption segments. Search output includes context and source timestamps; expand to the actual full sentence, verify the wording where feasible, then use a dictionary to select the attested sense and IPA. Follow `AGENTS.md` for note formatting, links, preservation of existing content, quotation limits, and committing/pushing checked task changes to `vault` unless the user requests otherwise. Never push private data or unrelated commits. Do not add a duplicate example on repeated requests.

The scripts cache source **transcripts**, not Japanese translations. Notes remain English unless translations are explicitly requested. If a requested example cannot be verified, report the actual limitation instead of manufacturing a quotation or treating an unrelated public search result as watched history.

Run only one workflow command at a time: atomic replacement protects files from interrupted writes but does not coordinate concurrent writers. Do not run a second agent against the same cache while a command is writing it.

## Offline validation

```bash
python3 -m unittest discover -s tests/youtube -v
bash -n tools/youtube/setup.sh tools/youtube/run.sh
python3 tools/youtube/youtube.py --help
```

Tests use synthetic data in isolated temporary directories. They cover history/date parsing, incremental merging, caption-boundary matching, malformed cache recovery, cache hits without caption API calls, and privacy boundaries. They do not authenticate to Google or prove that YouTube accepts Cloud traffic.

References: [current Cloud environment setup, personal values and saved task state](https://learn.chatgpt.com/docs/environments/cloud-environments), [legacy setup/secrets](https://learn.chatgpt.com/docs/environments/cloud-environment), [YouTube API history restrictions](https://developers.google.com/youtube/data/revision_history#september-15-2016), [transcript API usage and cloud IP blocks](https://github.com/jdepoix/youtube-transcript-api#working-around-ip-bans-requestblocked-or-ipblocked-exception).
