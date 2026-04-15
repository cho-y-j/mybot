import { SectionWrapper } from "@/components/ui/section-wrapper";
import { EyebrowTag } from "@/components/ui/eyebrow-tag";
import { PillButton } from "@/components/ui/pill-button";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const PLANS = [
  {
    name: "Basic",
    price: "무료",
    description: "홍보 사이트 시작에 필요한 모든 것",
    highlighted: false,
    features: [
      { text: "홈페이지 생성 + 3종 템플릿", included: true },
      { text: "콘텐츠 관리 (CRUD)", included: true },
      { text: "이미지 최대 50장", included: true },
      { text: "저장 용량 100MB", included: true },
      { text: "방문자 기본 통계", included: true },
      { text: "QR코드 생성", included: true },
      { text: "GA4 연동", included: false },
      { text: "주간 리포트", included: false },
      { text: "커스텀 도메인", included: false },
    ],
  },
  {
    name: "Premium",
    price: "월 9,900원",
    description: "데이터 기반 홍보 전략까지",
    highlighted: true,
    features: [
      { text: "Basic의 모든 기능", included: true },
      { text: "이미지 최대 500장", included: true },
      { text: "저장 용량 2GB", included: true },
      { text: "GA4 실시간 연동", included: true },
      { text: "블로그/유튜브 분석", included: true },
      { text: "주간 리포트 자동 생성", included: true },
      { text: "카카오 SDK 연동", included: true },
      { text: "커스텀 도메인", included: true },
      { text: "PDF 리포트 다운로드", included: true },
    ],
  },
];

export function PricingSection() {
  return (
    <SectionWrapper id="pricing">
      <div className="mb-16 text-center">
        <EyebrowTag className="mb-4">요금제</EyebrowTag>
        <h2 className="text-3xl font-bold leading-tight tracking-tight text-zinc-50 md:text-5xl">
          필요한 만큼만, 합리적으로
        </h2>
      </div>

      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`relative rounded-[2rem] p-1.5 ring-1 transition-all duration-500 ease-supanova ${
              plan.highlighted
                ? "scale-[1.02] bg-accent/10 ring-accent/30 shadow-[0_0_40px_rgba(16,185,129,0.1)]"
                : "bg-white/5 ring-white/10"
            }`}
          >
            {plan.highlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1 text-xs font-semibold text-zinc-950">
                가장 인기
              </div>
            )}

            <div className="rounded-[calc(2rem-0.375rem)] bg-zinc-900/80 p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]">
              <div className="mb-6">
                <h3 className="text-xl font-bold text-zinc-100">{plan.name}</h3>
                <div className="mt-2 text-3xl font-bold text-zinc-50">
                  {plan.price}
                </div>
                <p className="mt-1 text-sm text-zinc-500">{plan.description}</p>
              </div>

              <ul className="mb-8 flex flex-col gap-3">
                {plan.features.map((f) => (
                  <li key={f.text} className="flex items-center gap-2 text-sm">
                    <IconifyIcon
                      icon={
                        f.included
                          ? "solar:check-circle-bold"
                          : "solar:close-circle-linear"
                      }
                      width="18"
                      height="18"
                    />
                    <span
                      className={
                        f.included ? "text-zinc-300" : "text-zinc-600"
                      }
                    >
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>

              <PillButton
                href="#cta"
                variant={plan.highlighted ? "primary" : "secondary"}
                className="w-full justify-center"
              >
                {plan.highlighted ? "Premium 시작하기" : "시작하기"}
              </PillButton>
            </div>
          </div>
        ))}
      </div>
    </SectionWrapper>
  );
}
