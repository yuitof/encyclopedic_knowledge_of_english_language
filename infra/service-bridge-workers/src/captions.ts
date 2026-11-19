import { SaxesParser } from "saxes";
import { CookieJar } from "tough-cookie";
import { cancel, failure, type Outbound, ProbeError, readText } from "./network";

export const VIDEO_ID = "aircAruvnKk";
export function validVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[-_A-Za-z0-9]{11}$/.test(value);
}
const ORIGIN = "https://www.youtube.com";
const PLAYER_CONTEXT = { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } };
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export function captionUrl(raw: unknown, videoId: string = VIDEO_ID): string {
  if (!validVideoId(videoId)) throw new ProbeError("invalid_video_id");
  if (typeof raw !== "string" || raw.length > 16_384 || /[\\\s#]/.test(raw) ||
      !/^https:\/\/(?:www\.)?youtube\.com(?::443)?\/api\/timedtext\?/.test(raw)) {
    throw new ProbeError("invalid_caption_url");
  }
  const url = new URL(raw);
  const videos = url.searchParams.getAll("v");
  if (videos.length !== 1 || videos[0] !== videoId) throw new ProbeError("invalid_caption_url");
  if (url.searchParams.getAll("exp").includes("xpe")) throw new ProbeError("proof_token_required");
  return raw;
}

function timestamp(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) &&
    Number.isFinite(Number(value)) && Number(value) >= 0;
}

function countJson(source: string): number {
  const { events } = JSON.parse(source);
  if (!Array.isArray(events)) throw new Error();
  return events.reduce((count: number, event) => {
    if (event.segs === undefined) return count;
    if (!Array.isArray(event.segs) || !event.segs.every((part: { utf8?: unknown }) =>
      typeof part?.utf8 === "string")) throw new Error();
    if (!event.segs.some((part: { utf8: string }) => part.utf8.trim())) return count;
    if (!timestamp(event.tStartMs) || !timestamp(event.dDurationMs ?? 0)) throw new Error();
    return count + 1;
  }, 0);
}

function countXml(source: string): number {
  const parser = new SaxesParser();
  const path: string[] = [];
  let caption: { depth: number; hasText: boolean } | undefined;
  let count = 0;
  parser.on("doctype", () => { throw new Error(); });
  parser.on("opentag", ({ name, attributes }) => {
    if (path.length >= 64) throw new Error();
    if (path.length === 0 && name !== "transcript" && name !== "timedtext") throw new Error();
    const legacy = path.length === 1 && path[0] === "transcript";
    if (legacy && name !== "text") throw new Error();
    const srv3Body = path.length === 2 && path[0] === "timedtext" && path[1] === "body";
    if (srv3Body && name !== "p" && name !== "w") throw new Error();
    const srv3 = srv3Body && name === "p";
    path.push(name);
    if (legacy || srv3) {
      if (!timestamp(attributes[legacy ? "start" : "t"]) ||
          !timestamp(attributes[legacy ? "dur" : "d"] ?? 0)) throw new Error();
      caption = { depth: path.length, hasText: false };
    }
  });
  const append = (text: string) => {
    if (caption && !caption.hasText && text.trim()) caption.hasText = true;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (caption?.depth === path.length) {
      if (caption.hasText) count += 1;
      caption = undefined;
    }
    path.pop();
  });
  parser.write(source).close();
  return count;
}

export function countSegments(source: string): number {
  try {
    const count = source.trimStart().startsWith("{") ? countJson(source) : countXml(source);
    if (count > 0) return count;
  } catch {
    // Parser errors may contain caption contents.
  }
  throw new ProbeError("invalid_caption_response");
}

const STATUS = new Set(["OK", "ERROR", "LOGIN_REQUIRED", "UNPLAYABLE", "CONTENT_CHECK_REQUIRED",
  "AGE_CHECK_REQUIRED", "LIVE_STREAM_OFFLINE"]);
const KNOWN_MESSAGES = new Set([
  "This video is unavailable", "Video unavailable", "This video is not available",
  "Sign in to confirm you’re not a bot", "Sign in to confirm you're not a bot",
  "This video is private", "This content isn't available", "This content isn’t available",
  "This video is not available in your country", "This content is not available in your country.",
  "The following content is not available on this app. Watch this content on the latest version of YouTube.",
]);

function safeMessage(value: unknown) {
  return typeof value === "string" && KNOWN_MESSAGES.has(value) ? value : "[redacted]";
}

export function playerSummary(status: { status?: unknown; reason?: unknown; messages?: unknown }) {
  return {
    status: typeof status.status === "string" && STATUS.has(status.status) ? status.status : "[redacted]",
    ...(status.reason === undefined ? {} : { reason: safeMessage(status.reason) }),
    ...(status.messages === undefined ? {} : {
      messages: Array.isArray(status.messages) ? status.messages.slice(0, 4).map(safeMessage) : ["[redacted]"],
    }),
  };
}

export async function captionProbe(send: Outbound, signal: AbortSignal) {
  const statuses: Record<string, number> = {};
  let stage = "watch";
  let playability: ReturnType<typeof playerSummary> | undefined;
  // Each run starts with an empty jar, scoped to cookies returned by YouTube itself.
  const jar = new CookieJar();
  async function read(url: string, limit: number, body?: string) {
    const headers = new Headers({ "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.9", accept: "*/*" });
    if (body) headers.set("content-type", "application/json");
    const cookies = jar.getCookieStringSync(url);
    if (cookies) headers.set("cookie", cookies);
    const response = await send(url, { method: body ? "POST" : "GET", headers, body });
    statuses[stage] = response.status;
    if (response.status !== 200) {
      const redirect = response.status >= 300 && response.status < 400;
      if (!redirect && stage === "player" &&
          response.headers.get("content-type")?.includes("application/json")) {
        try {
          const status = JSON.parse(await readText(response, 64_000))?.playabilityStatus;
          if (typeof status?.status === "string") playability = playerSummary(status);
        } catch {
          // Non-200 responses may contain an unrelated body. Keep the HTTP status.
        }
      } else {
        cancel(response.body);
      }
      throw new ProbeError(redirect ? "redirect_rejected" : "upstream_http", response.status);
    }
    for (const cookie of response.headers.getSetCookie()) {
      jar.setCookieSync(cookie, url, { ignoreError: true });
    }
    return readText(response, limit);
  }

  try {
    const watch = await read(`${ORIGIN}/watch?v=${VIDEO_ID}&hl=en`, 8_000_000);
    const key = /"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]+)"/.exec(watch)?.[1];
    if (!key) throw new ProbeError("player_configuration_missing");
    stage = "player";
    const player = await read(`${ORIGIN}/youtubei/v1/player?key=${key}`, 4_000_000,
      JSON.stringify({ context: PLAYER_CONTEXT, videoId: VIDEO_ID }));
    let payload;
    try {
      payload = JSON.parse(player);
      if (payload?.error || typeof payload?.playabilityStatus?.status !== "string") throw new Error();
    } catch {
      throw new ProbeError("invalid_player_response");
    }
    playability = playerSummary(payload.playabilityStatus);
    if (playability.status !== "OK") throw new ProbeError("video_access_restricted");
    const tracks = payload.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const track = Array.isArray(tracks) && tracks.find((item) =>
      /^en(?:-[A-Za-z0-9]+)*$/i.test(item?.languageCode) && item.kind === undefined);
    if (!track) throw new ProbeError("manual_english_track_missing");
    stage = "timedtext";
    const source = await read(captionUrl(track.baseUrl, VIDEO_ID), 4_000_000);
    return { ok: true, statuses, playability, captionType: "manual",
      language: track.languageCode, segments: countSegments(source) };
  } catch (error) {
    return { ok: false, stage, statuses, playability, ...failure(error, signal) };
  }
}
