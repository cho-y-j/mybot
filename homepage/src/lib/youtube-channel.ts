/**
 * YouTube URL/handle → channelId(UCxxx) 해결 유틸.
 *
 * 지원 입력:
 *   - https://youtube.com/channel/UCxxx             → 바로 추출
 *   - https://youtube.com/@handle[/suffix]          → channels.list?forHandle
 *   - @handle 또는 handle (순수 핸들 문자열)         → forHandle
 *   - https://youtube.com/c/Name or /user/Name     → search.list 폴백
 *   - 순수 UCxxx 채널ID 문자열                       → 그대로 반환
 *
 * 쇼츠는 uploads 플레이리스트에 일반 영상과 함께 포함되므로 channelId만
 * 해결되면 추가 작업 없이 쇼츠도 자동 수집됨.
 */

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{10,}$/;

export async function resolveYoutubeChannelId(
  urlOrHandle: string,
  apiKey: string,
): Promise<string | null> {
  if (!apiKey) return null;
  const raw = (urlOrHandle || "").trim();
  if (!raw) return null;

  // 1) /channel/UCxxx 직접 추출
  const channelMatch = raw.match(/\/channel\/(UC[A-Za-z0-9_-]{10,})/);
  if (channelMatch) return channelMatch[1];

  // 2) 이미 UCxxx 채널ID
  if (CHANNEL_ID_RE.test(raw)) return raw;

  // 3) @handle (URL encode된 한글 포함)
  let handle: string | null = null;
  const handleUrl = raw.match(/\/@([^\/\s?#]+)/);
  if (handleUrl) handle = handleUrl[1];
  else if (raw.startsWith("@")) handle = raw.slice(1);

  if (handle) {
    let decoded = handle;
    try { decoded = decodeURIComponent(handle); } catch { /* keep raw */ }
    const id = await fetchForHandle(decoded, apiKey);
    if (id) return id;
  }

  // 4) /c/xxx 또는 /user/xxx → search 폴백
  const custom = raw.match(/\/(c|user)\/([^\/\s?#]+)/);
  if (custom) {
    let q = custom[2];
    try { q = decodeURIComponent(q); } catch { /* keep */ }
    const id = await fetchViaSearch(q, apiKey);
    if (id) return id;
  }

  return null;
}

async function fetchForHandle(handle: string, apiKey: string): Promise<string | null> {
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function fetchViaSearch(query: string, apiKey: string): Promise<string | null> {
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=1&key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.items?.[0];
    return first?.snippet?.channelId || first?.id?.channelId || null;
  } catch {
    return null;
  }
}
