import { SectionWrapper } from "@/components/ui/section-wrapper";
import { PillButton } from "@/components/ui/pill-button";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const TRUST_BADGES = [
  { icon: "solar:download-minimalistic-linear", text: "설치 불필요" },
  { icon: "solar:card-linear", text: "카드 등록 없음" },
  { icon: "solar:bolt-linear", text: "즉시 ���작" },
];

export function CtaSection() {
  return (
    <SectionWrapper id="cta" className="relative overflow-hidden">
      {/* Gradient Mesh Background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/3 top-1/3 h-[500px] w-[500px] rounded-full bg-accent/8 blur-[150px]" />
        <div className="absolute right-1/4 bottom-1/4 h-[300px] w-[300px] rounded-full bg-emerald-800/10 blur-[120px]" />
      </div>

      <div className="text-center">
        <h2 className="mb-6 text-4xl font-bold leading-tight tracking-tight text-zinc-50 md:text-6xl">
          지금 바로 시작해보세요
        </h2>
        <p className="mx-auto mb-10 max-w-[45ch] text-lg leading-relaxed text-zinc-400">
          3분이면 충분합니다. 나만의 홍보 사이트를 만들어보세요.
        </p>

        <PillButton href="/signup" variant="primary" className="mx-auto">
          시작하기
        </PillButton>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
          {TRUST_BADGES.map((badge) => (
            <div
              key={badge.text}
              className="flex items-center gap-2 text-sm text-zinc-500"
            >
              <IconifyIcon icon={badge.icon} width="16" height="16" />
              <span>{badge.text}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}
