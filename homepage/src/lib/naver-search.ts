/**
 * 네이버 검색 API 기반 후보자 SNS 자동 추출.
 *
 * 후보 이름 + 지역 조합으로 검색 → 결과의 link / description 에서 SNS URL 추출.
 * 동명이인 위험은 사용자가 최종 체크박스로 고르는 단계에서 거름.
 */

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "";

export type SuggestedContact = {
  type: "instagram" | "facebook" | "youtube" | "blog" | "tistory" | "brunch";
  url: string;
  value: string; // 표시용 핸들/이름
  source: string; // 검색 상위 N 번째 등 근거
  matchedIn: string; // description 일부 — 사용자가 본인 것인지 판단 근거
};

const URL_PATTERNS: Array<{ type: SuggestedContact["type"]; re: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  // Instagram: https://www.instagram.com/handle
  {
    type: "instagram",
    re: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/g,
    extract: (m) => `@${m[1]}`,
  },
  // Facebook: https://www.facebook.com/handle or /people/name/id
  {
    type: "facebook",
    re: /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!(?:watch|groups|events|share|sharer|tr|dialog)\b)([a-zA-Z0-9._%-]+)(?:\/[a-zA-Z0-9._-]+)?\/?/g,
    extract: (m) => m[1] === "people" ? "페이스북" : m[1],
  },
  // Naver Blog
  {
    type: "blog",
    re: /https?:\/\/blog\.naver\.com\/([a-zA-Z0-9_-]{3,20})(?:\/|$|\?)/g,
    extract: (m) => `blog.naver.com/${m[1]}`,
  },
  // YouTube @handle or /channel/UCxxx
  {
    type: "youtube",
    re: /https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@([^\/\s?"]+)|channel\/(UC[A-Za-z0-9_-]+))/g,
    extract: (m) => m[1] ? `@${m[1]}` : m[2],
  },
  // Tistory
  {
    type: "tistory",
    re: /https?:\/\/([a-zA-Z0-9_-]+)\.tistory\.com\/?/g,
    extract: (m) => `${m[1]}.tistory.com`,
  },
];

interface NaverItem {
  title?: string;
  link?: string;
  description?: string;
  bloggerlink?: string;
}

async function naverFetch(path: string, query: string): Promise<NaverItem[]> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/${path}?query=${encodeURIComponent(query)}&display=20&sort=sim`,
      {
        headers: {
          "X-Naver-Client-Id": NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.items || []) as NaverItem[];
  } catch {
    return [];
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#\d+;/g, "").trim();
}

/**
 * 후보자 이름 + 지역 + 직함으로 네이버 검색 → SNS URL 후보 추출.
 *
 * - 여러 검색어 조합으로 웹/블로그 검색 병렬 호출
 * - 각 결과의 link / description에서 SNS 패턴 매칭
 * - 같은 URL 중복 제거, 이름 매칭 힌트가 있는 결과 우선
 */
export async function suggestContactsFromNaver(opts: {
  name: string;
  region?: string;
  positionTitle?: string;
}): Promise<SuggestedContact[]> {
  const { name, region, positionTitle } = opts;
  if (!name) return [];

  // 검색 쿼리 조합
  const queries = [
    `${name} ${positionTitle || ""}`.trim(),
    `${name} ${region || ""}`.trim(),
    `${name} 인스타그램`,
    `${name} 페이스북`,
    `${name} 블로그`,
    `${name} 유튜브`,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  // 웹 + 블로그 검색 병렬
  const allItems = (
    await Promise.all(
      queries.flatMap((q) => [naverFetch("webkr", q), naverFetch("blog", q)]),
    )
  ).flat();

  // 매칭된 URL을 Map으로 중복 제거 (동일 type+url이면 1건)
  const bucket = new Map<string, SuggestedContact>();
  for (const item of allItems) {
    const textPool = [item.link || "", item.bloggerlink || "", stripTags(item.title || ""), stripTags(item.description || "")].join(" ");

    for (const { type, re, extract } of URL_PATTERNS) {
      // global regex는 매 호출마다 lastIndex 초기화 필요
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(textPool)) !== null) {
        const rawUrl = m[0].replace(/[)\]}"',.]+$/, "");
        const value = extract(m);
        const key = `${type}:${rawUrl.toLowerCase()}`;
        if (bucket.has(key)) continue;

        // 후보 이름이 설명 텍스트에 있으면 매칭 힌트로 저장
        const snippet = stripTags(item.description || item.title || "").slice(0, 120);
        bucket.set(key, {
          type,
          url: rawUrl,
          value,
          source: item.title ? stripTags(item.title).slice(0, 60) : "",
          matchedIn: snippet,
        });
      }
    }
  }

  // 이름이 description에 포함된 것을 먼저, 나머지는 뒤로
  return Array.from(bucket.values()).sort((a, b) => {
    const aHit = a.matchedIn.includes(name) || a.source.includes(name) ? 0 : 1;
    const bHit = b.matchedIn.includes(name) || b.source.includes(name) ? 0 : 1;
    return aHit - bHit;
  }).slice(0, 20);
}
