/**
 * 후보 공식 블로그(네이버/티스토리/브런치) 최신 글 자동 표시.
 * - /api/public/blog-feed/{code} 클라이언트 fetch (RSS 파싱)
 * - 등록 채널 없거나 글 없으면 섹션 자체 숨김
 */
"use client";

import { useEffect, useState } from "react";

interface BlogPost {
  url: string;
  title: string;
  platform?: string;
  channel?: string;
  summary?: string;
  published_at?: string;
}

const platformLabel = (p?: string) =>
  p === "naver_blog" ? "네이버 블로그" :
  p === "tistory" ? "티스토리" :
  p === "brunch" ? "브런치" : "";

const platformColor = (p?: string) =>
  p === "naver_blog" ? "bg-green-500/10 text-green-700" :
  p === "tistory" ? "bg-orange-500/10 text-orange-700" :
  p === "brunch" ? "bg-sky-500/10 text-sky-700" :
  "bg-gray-500/10 text-gray-700";

export default function ElectionBlog({
  code,
  sectionTitle,
  showCount = 6,
}: {
  code: string;
  sectionTitle?: string;
  showCount?: number;
}) {
  const [items, setItems] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/public/blog-feed/${code}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.data?.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [code]);

  if (loading || items.length === 0) {
    // 로딩 중 또는 글 없으면 섹션 숨김 (빈 공간 차지 안 함)
    return null;
  }

  const visible = items.slice(0, showCount);

  return (
    <section id="blog" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-10 text-center">
          <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
            {sectionTitle || "블로그"}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            공식 블로그의 최신 글을 자동으로 불러옵니다
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((p, i) => (
            <a
              key={`${p.url}-${i}`}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
            >
              <div className="mb-3 flex items-center gap-2">
                {p.platform && (
                  <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${platformColor(p.platform)}`}>
                    {platformLabel(p.platform)}
                  </span>
                )}
                {p.published_at && (
                  <span className="text-xs text-gray-400">
                    {new Date(p.published_at).toLocaleDateString("ko", {
                      year: "numeric", month: "short", day: "numeric",
                    })}
                  </span>
                )}
              </div>
              <h3 className="mb-2 line-clamp-2 font-semibold text-gray-900 leading-snug">
                {p.title}
              </h3>
              {p.summary && (
                <p className="line-clamp-3 text-sm text-gray-600 leading-relaxed">
                  {p.summary}
                </p>
              )}
            </a>
          ))}
        </div>
        {items.length > showCount && (
          <div className="mt-8 text-center text-sm text-gray-500">
            총 {items.length}건 중 최신 {showCount}건 표시
          </div>
        )}
      </div>
    </section>
  );
}
