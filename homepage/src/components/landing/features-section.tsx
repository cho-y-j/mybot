import { SectionWrapper } from "@/components/ui/section-wrapper";
import { EyebrowTag } from "@/components/ui/eyebrow-tag";
import { DoubleBezelCard } from "@/components/ui/double-bezel-card";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const FEATURES = [
  {
    icon: "solar:monitor-smartphone-bold",
    title: "원페이지 홍보 사이트",
    description:
      "선거 후보, 개인 명함, 소상공인을 위한 3종 전문 템플릿. 코딩 없이 나만의 사이트를 완성하세요.",
    span: "md:col-span-8",
  },
  {
    icon: "solar:chart-2-bold",
    title: "실시간 방문자 분��",
    description: "누가, 언제, 어디서 방문했는지 한눈에 파악하세요.",
    span: "md:col-span-4",
  },
  {
    icon: "solar:pen-new-round-bold",
    title: "쉬운 콘텐츠 관리",
    description: "드래그앤드롭으로 사진, 공약, 일정을 간편하게 관리하세요.",
    span: "md:col-span-4",
  },
  {
    icon: "solar:graph-new-up-bold",
    title: "GA4 연동 + 주간 리포트",
    description:
      "구글 애널리틱스 연동부터 자동 주간 리포트까지. 데이터 기반으로 홍보 전략을 세우세요.",
    span: "md:col-span-8",
  },
  {
    icon: "solar:share-circle-bold",
    title: "카카오톡 공유 + QR코드",
    description: "카카오톡 한 번으로 공유 완료. QR코드로 오프라인에서도 연결하세요.",
    span: "md:col-span-6",
  },
  {
    icon: "solar:smartphone-bold",
    title: "모바일 완벽 최적화",
    description: "방문자의 70% 이상이 모바일. 어떤 화면에서도 완벽하게 보입니다.",
    span: "md:col-span-6",
  },
];

export function FeaturesSection() {
  return (
    <SectionWrapper id="features">
      <div className="mb-16 text-center">
        <EyebrowTag className="mb-4">주요 기능</EyebrowTag>
        <h2 className="text-3xl font-bold leading-tight tracking-tight text-zinc-50 md:text-5xl">
          홍보부터 분석까지, 한 곳에서
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        {FEATURES.map((feature, i) => (
          <DoubleBezelCard
            key={feature.title}
            className={`${feature.span} transition-all duration-500 ease-supanova`}
            innerClassName="flex flex-col gap-4 h-full"
          >
            <div
              className="reveal-hidden"
              style={{ "--index": i } as React.CSSProperties}
            >
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
                <IconifyIcon
                  icon={feature.icon}
                  width="24"
                  height="24"
                />
              </div>
              <h3 className="text-xl font-bold text-zinc-100">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-zinc-400">
                {feature.description}
              </p>
            </div>
          </DoubleBezelCard>
        ))}
      </div>
    </SectionWrapper>
  );
}
