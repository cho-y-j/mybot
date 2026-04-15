import { EyebrowTag } from "@/components/ui/eyebrow-tag";
import { PillButton } from "@/components/ui/pill-button";

export function HeroSection() {
  return (
    <section className="relative min-h-[100dvh] overflow-hidden pt-32 pb-20">
      {/* Gradient Mesh Background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/4 h-[600px] w-[600px] rounded-full bg-accent/5 blur-[120px]" />
        <div className="absolute right-1/4 bottom-1/4 h-[400px] w-[400px] rounded-full bg-emerald-900/10 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-5 lg:gap-16">
          {/* Left — Text (3 cols) */}
          <div className="lg:col-span-3">
            <EyebrowTag className="mb-6">
              선거 · 명함 · 소상공인 홍보 플랫폼
            </EyebrowTag>

            <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight text-zinc-50 text-balance sm:text-5xl md:text-6xl lg:text-7xl">
              당신의 이야기를,
              <br />
              가장 돋보이게
              <br />
              전하는 방법
            </h1>

            <p className="mb-10 max-w-[55ch] text-base leading-relaxed text-zinc-400 md:text-lg">
              복잡한 코딩 없이, 3분이면 완성되는 나만의 홍보 사이트.
              선거 후보부터 소상공인까지, 전문가가 만든 듯한 디자인으로
              방문자의 시선을 사로잡으세요.
            </p>

            <div className="flex flex-col gap-4 sm:flex-row">
              <PillButton href="/signup" variant="primary">
                시작하기
              </PillButton>
              <PillButton href="/kim" variant="secondary">
                선거후보 미리보기
              </PillButton>
            </div>
          </div>

          {/* Right — Z-Axis Card Stack (2 cols) */}
          <div className="relative mx-auto h-[420px] w-full max-w-[360px] lg:col-span-2 lg:mx-0">
            {/* Card 1 — 선거 */}
            <div className="absolute left-0 top-0 z-10 w-[280px] transform -rotate-3 rounded-2xl border border-white/10 bg-zinc-900/90 p-4 shadow-2xl transition-all duration-500 ease-supanova hover:-translate-y-2 hover:-translate-x-4 hover:-rotate-6">
              <div className="mb-3 h-[160px] w-full overflow-hidden rounded-xl bg-gradient-to-br from-red-900/30 to-red-800/10">
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <div className="mb-1 text-xs text-red-300/60">선거 홍보</div>
                    <div className="text-lg font-bold text-zinc-200">후보자명</div>
                    <div className="text-xs text-zinc-500">제21대 시의원 선거</div>
                  </div>
                </div>
              </div>
              <div className="text-xs font-medium text-zinc-400">선거 템플릿</div>
            </div>

            {/* Card 2 — 명함 */}
            <div className="absolute left-10 top-16 z-20 w-[280px] transform rotate-0 rounded-2xl border border-white/10 bg-zinc-900/90 p-4 shadow-2xl transition-all duration-500 ease-supanova hover:-translate-y-2 hover:rotate-2">
              <div className="mb-3 h-[160px] w-full overflow-hidden rounded-xl bg-gradient-to-br from-blue-900/30 to-blue-800/10">
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <div className="mb-1 text-xs text-blue-300/60">개인 명함</div>
                    <div className="text-lg font-bold text-zinc-200">홍길동</div>
                    <div className="text-xs text-zinc-500">프로덕트 디자이너</div>
                  </div>
                </div>
              </div>
              <div className="text-xs font-medium text-zinc-400">명함 템플릿</div>
            </div>

            {/* Card 3 — 가게 */}
            <div className="absolute left-5 top-32 z-30 w-[280px] transform rotate-3 rounded-2xl border border-white/10 bg-zinc-900/90 p-4 shadow-2xl transition-all duration-500 ease-supanova hover:-translate-y-2 hover:translate-x-4 hover:rotate-6">
              <div className="mb-3 h-[160px] w-full overflow-hidden rounded-xl bg-gradient-to-br from-amber-900/30 to-amber-800/10">
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <div className="mb-1 text-xs text-amber-300/60">소상공인</div>
                    <div className="text-lg font-bold text-zinc-200">카페 이름</div>
                    <div className="text-xs text-zinc-500">수제 커피 전문점</div>
                  </div>
                </div>
              </div>
              <div className="text-xs font-medium text-zinc-400">가게 템플릿</div>
            </div>

            {/* Floating decorative orb */}
            <div className="absolute -right-8 -bottom-8 h-32 w-32 rounded-full bg-accent/10 blur-2xl animate-float" />
          </div>
        </div>
      </div>
    </section>
  );
}
