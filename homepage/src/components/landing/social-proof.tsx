"use client";

import { useCountUp } from "@/hooks/use-count-up";

const METRICS = [
  { end: 2847, suffix: "+", label: "생성된 홍보 사이트" },
  { end: 4.87, suffix: "/5.0", label: "고객 만족도", decimals: 2 },
  { end: 1200, suffix: "만+", label: "누적 방��자" },
  { end: 3, suffix: "분", label: "평균 제작 시간" },
];

const LOGOS = [
  "서울특별시", "경기도청", "부산광역시", "인천광역시",
  "대전광역시", "광주광역시", "수원시", "성남시",
];

function MetricItem({
  end,
  suffix,
  label,
  decimals = 0,
}: {
  end: number;
  suffix: string;
  label: string;
  decimals?: number;
}) {
  const { ref, display } = useCountUp({ end, suffix, decimals, duration: 2000 });

  return (
    <div className="text-center">
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        className="text-3xl font-bold text-zinc-50 tabular-nums md:text-4xl"
      >
        {display}
      </div>
      <div className="mt-1 text-sm text-zinc-500">{label}</div>
    </div>
  );
}

export function SocialProof() {
  return (
    <section className="border-y border-white/5 py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Metrics Bar */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {METRICS.map((m) => (
            <MetricItem key={m.label} {...m} />
          ))}
        </div>

        {/* Logo Marquee */}
        <div className="mt-12 overflow-hidden">
          <div className="marquee-track flex animate-marquee gap-12">
            {[...LOGOS, ...LOGOS].map((logo, i) => (
              <div
                key={i}
                className="flex h-10 shrink-0 items-center rounded-lg bg-white/5 px-6 text-sm text-zinc-600 grayscale transition-all duration-300 hover:text-zinc-300 hover:grayscale-0"
              >
                {logo}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
