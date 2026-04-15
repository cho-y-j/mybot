import { SectionWrapper } from "@/components/ui/section-wrapper";
import { EyebrowTag } from "@/components/ui/eyebrow-tag";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const USE_CASES = [
  {
    eyebrow: "선거 후보",
    title: "유권자에게 진심을 전하는 디지털 선거운동",
    description:
      "공약, 이력, 활동 사진, 유튜브 영상까지 한 페이지에. D-Day 카운트다운과 카카오톡 공유로 더 많은 유권자에게 닿으세요.",
    icon: "solar:flag-bold",
    gradient: "from-red-900/20 to-red-800/5",
    features: ["D-Day 카운트다운", "공약 카드", "카카오톡 공유", "방문자 분석"],
  },
  {
    eyebrow: "개인 명함",
    title: "URL 하나로 전하는 나의 모든 것",
    description:
      "이력, 포트폴리오, 연락처를 깔끔하게 정리한 디지털 명함. QR코드 하나면 명함 교환 끝.",
    icon: "solar:user-id-bold",
    gradient: "from-blue-900/20 to-blue-800/5",
    features: ["프로필 타임라인", "포트폴리오 갤러리", "QR코드 vCard", "SNS 연동"],
  },
  {
    eyebrow: "소상공인",
    title: "우리 가게를 가장 매력적으로 보여주는 방법",
    description:
      "메뉴판, 사진, 영업시간, 위치 안내까지. 네이버 예약 연동으로 바로 고객을 만나세요.",
    icon: "solar:shop-bold",
    gradient: "from-amber-900/20 to-amber-800/5",
    features: ["메뉴판 카드", "갤러리", "지도 연동", "네이버 예약 링크"],
  },
];

export function UseCasesSection() {
  return (
    <SectionWrapper id="use-cases">
      <div className="mb-16 text-center">
        <EyebrowTag className="mb-4">이런 분들이 사용합니다</EyebrowTag>
        <h2 className="text-3xl font-bold leading-tight tracking-tight text-zinc-50 md:text-5xl">
          어떤 목적이든, 최적의 결과를
        </h2>
      </div>

      <div className="flex flex-col gap-20">
        {USE_CASES.map((uc, i) => (
          <div
            key={uc.eyebrow}
            className={`grid grid-cols-1 items-center gap-10 lg:grid-cols-2 ${
              i % 2 === 1 ? "lg:direction-rtl" : ""
            }`}
          >
            {/* Image placeholder */}
            <div
              className={`overflow-hidden rounded-3xl bg-gradient-to-br ${uc.gradient} border border-white/5 p-8 ${
                i % 2 === 1 ? "lg:order-2" : ""
              }`}
            >
              <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-zinc-900/50">
                <div className="text-center">
                  <IconifyIcon icon={uc.icon} width="48" height="48" />
                  <div className="mt-3 text-sm text-zinc-500">
                    {uc.eyebrow} 템플릿 미리보기
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className={i % 2 === 1 ? "lg:order-1" : ""}>
              <EyebrowTag className="mb-4">{uc.eyebrow}</EyebrowTag>
              <h3 className="mb-4 text-2xl font-bold leading-snug text-zinc-50 md:text-3xl">
                {uc.title}
              </h3>
              <p className="mb-6 max-w-[50ch] text-base leading-relaxed text-zinc-400">
                {uc.description}
              </p>
              <div className="flex flex-wrap gap-2">
                {uc.features.map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-white/10"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionWrapper>
  );
}
