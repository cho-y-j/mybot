import { SectionWrapper } from "@/components/ui/section-wrapper";
import { EyebrowTag } from "@/components/ui/eyebrow-tag";
import { DoubleBezelCard } from "@/components/ui/double-bezel-card";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const TESTIMONIALS = [
  {
    name: "박도현",
    role: "시의원 후보",
    avatar: "parkdohyun",
    rating: 5,
    text: "선거 운동 기간에 이 정도 퀄리티의 사이트를 직접 만들 수 있을 거라곤 생각도 못했습니다. 공약 정리부터 사진첩까지 유권자 반응이 정말 좋았어요.",
  },
  {
    name: "이서진",
    role: "프리랜서 디자이너",
    avatar: "leeseojin",
    rating: 5,
    text: "포트폴리오를 따로 관리하기 번거로웠는데, QR코드 하나로 명함 교환이 끝나니까 미팅할 때 확실히 편해졌습니다.",
  },
  {
    name: "하윤서",
    role: "카페 리브레 대표",
    avatar: "hayunseo",
    rating: 5,
    text: "인스타그램만으로는 부족했던 메뉴판, 위치 안내, 영업시간을 한 페이지에 다 담을 수 있어서 만족합니다. 네이버 검색으로 찾아오는 손님이 늘었어요.",
  },
  {
    name: "정민준",
    role: "구의원 후보",
    avatar: "jungminjun",
    rating: 5,
    text: "주간 리포트 기능이 특히 유용했습니다. 어떤 공약에 관심이 많은지 데이터로 확인하니 선거 전략을 세우기가 훨씬 수월했어요.",
  },
  {
    name: "오예린",
    role: "마케팅 컨설턴트",
    avatar: "ohyerin",
    rating: 4,
    text: "고객사에 소상공인 사이트를 추천하기 좋습니다. GA4 연동까지 되니까 별도 툴 없이 성과 측정이 바로 가능하더라고요.",
  },
  {
    name: "최시우",
    role: "네일샵 대표",
    avatar: "choisiwoo",
    rating: 5,
    text: "손님 대부분이 모바일로 보시는데, 어떤 폰에서 열어도 깔끔하게 나와요. 시술 사진 올리는 것도 간단하고요.",
  },
];

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <IconifyIcon
          key={i}
          icon={i < count ? "solar:star-bold" : "solar:star-linear"}
          width="14"
          height="14"
        />
      ))}
    </div>
  );
}

export function TestimonialsSection() {
  return (
    <SectionWrapper id="testimonials">
      <div className="mb-16 text-center">
        <EyebrowTag className="mb-4">고객 후기</EyebrowTag>
        <h2 className="text-3xl font-bold leading-tight tracking-tight text-zinc-50 md:text-5xl">
          직접 경험한 분들의 이야기
        </h2>
      </div>

      {/* Masonry — CSS columns */}
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
        {TESTIMONIALS.map((t) => (
          <DoubleBezelCard key={t.name} className="mb-4 break-inside-avoid">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://i.pravatar.cc/150?u=${t.avatar}`}
                alt={t.name}
                width={40}
                height={40}
                className="rounded-full"
                loading="lazy"
                decoding="async"
              />
              <div>
                <div className="text-sm font-semibold text-zinc-100">
                  {t.name}
                </div>
                <div className="text-xs text-zinc-500">{t.role}</div>
              </div>
            </div>
            <div className="mt-3">
              <Stars count={t.rating} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {t.text}
            </p>
          </DoubleBezelCard>
        ))}
      </div>
    </SectionWrapper>
  );
}
