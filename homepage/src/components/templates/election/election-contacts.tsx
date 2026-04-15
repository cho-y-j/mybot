"use client";

import type { SiteData } from "@/types/site";

interface Props {
  contacts: SiteData["contacts"];
  kakaoAppKey: string | null;
  sectionTitle?: string;
}

const CONTACT_COLORS: Record<string, string> = {
  phone: "#4CAF50",
  email: "#F44336",
  instagram: "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)",
  facebook: "#1877F2",
  youtube: "#FF0000",
  blog: "#03C75A",
  threads: "#000000",
  kakaotalk: "#FEE500",
};

const CONTACT_META: Record<
  string,
  { icon: React.ReactNode; label: string; hrefPrefix?: string }
> = {
  phone: {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
    label: "전화",
    hrefPrefix: "tel:",
  },
  email: {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    label: "이메일",
    hrefPrefix: "mailto:",
  },
  instagram: {
    icon: (
      <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
    label: "인스타그램",
  },
  facebook: {
    icon: (
      <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    label: "페이스북",
  },
  youtube: {
    icon: (
      <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
    label: "유튜브",
  },
  blog: {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
    label: "블로그",
  },
  threads: {
    icon: (
      <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.96-.065-1.187.408-2.26 1.33-3.017.88-.724 2.104-1.139 3.546-1.205 1.07-.048 2.063.042 2.963.267.007-.694-.03-1.362-.112-1.983l2.02-.277c.12.878.174 1.823.163 2.81.82.36 1.533.85 2.104 1.461.848.908 1.355 2.073 1.467 3.37l.014.168-.005.17c.003.077.003.155.003.233 0 1.9-.68 3.655-1.972 5.082C18.042 22.95 15.578 23.977 12.186 24z" />
      </svg>
    ),
    label: "Threads",
  },
};

function copyToClipboard() {
  try {
    navigator.clipboard.writeText(window.location.href);
    alert("링크가 복사되었습니다!");
  } catch {
    // fallback
    const input = document.createElement("input");
    input.value = window.location.href;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
    alert("링크가 복사되었습니다!");
  }
}

export default function ElectionContacts({ contacts, kakaoAppKey, sectionTitle }: Props) {
  if (contacts.length === 0) return null;

  const sorted = [...contacts].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section id="contact" className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      {/* Section heading */}
      <div className="mb-10 text-center">
        <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
          {sectionTitle || "연락처"}
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((contact) => {
          const meta = CONTACT_META[contact.type];
          const href =
            contact.url ??
            (meta?.hrefPrefix ? `${meta.hrefPrefix}${contact.value}` : undefined);

          const inner = (
            <div className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200 group">
              <div
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-white"
                style={{
                  background: CONTACT_COLORS[contact.type] || "var(--primary)",
                  color: contact.type === "kakaotalk" ? "#3C1E1E" : "white",
                }}
              >
                {meta?.icon ?? (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {contact.label ?? meta?.label ?? contact.type}
                </p>
                <p className="truncate font-bold text-gray-900 mt-0.5">
                  {contact.value}
                </p>
              </div>
              {/* Arrow icon */}
              {href && (
                <svg className="h-5 w-5 flex-shrink-0 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          );

          if (href) {
            return (
              <a
                key={contact.id}
                href={href}
                target={contact.url ? "_blank" : undefined}
                rel={contact.url ? "noopener noreferrer" : undefined}
              >
                {inner}
              </a>
            );
          }

          return <div key={contact.id}>{inner}</div>;
        })}
      </div>

      {/* Share section */}
      <div className="mt-10 rounded-2xl bg-gray-50 p-6 text-center">
        <p className="mb-4 text-sm font-semibold text-gray-700">
          이 페이지를 공유해주세요
        </p>
        <div className="flex items-center justify-center gap-3">
          {kakaoAppKey && (
            <button
              onClick={() => {
                // Kakao share (requires Kakao SDK loaded)
                const w = window as unknown as Record<string, unknown>;
                if (w.Kakao) {
                  const Kakao = w.Kakao as {
                    isInitialized: () => boolean;
                    init: (key: string) => void;
                    Share: {
                      sendDefault: (params: Record<string, unknown>) => void;
                    };
                  };
                  if (!Kakao.isInitialized()) {
                    Kakao.init(kakaoAppKey);
                  }
                  Kakao.Share.sendDefault({
                    objectType: "feed",
                    content: {
                      title: document.title,
                      description: "",
                      imageUrl: "",
                      link: {
                        mobileWebUrl: window.location.href,
                        webUrl: window.location.href,
                      },
                    },
                  });
                }
              }}
              className="flex items-center gap-2 rounded-full bg-[#FEE500] px-5 py-2.5 text-sm font-bold text-[#3C1E1E] transition-opacity hover:opacity-90"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3C6.477 3 2 6.463 2 10.691c0 2.754 1.862 5.164 4.644 6.504-.144.528-.926 3.407-.955 3.613 0 0-.019.157.084.217.103.06.224.013.224.013.296-.04 3.425-2.247 3.96-2.634.659.094 1.34.143 2.043.143 5.523 0 10-3.463 10-7.856C22 6.463 17.523 3 12 3z" />
              </svg>
              카카오톡 공유
            </button>
          )}
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-2 rounded-full bg-gray-200 px-5 py-2.5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-300"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            링크 복사
          </button>
        </div>
      </div>
    </section>
  );
}
