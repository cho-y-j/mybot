import type { SiteData } from "@/types/site";

interface Props {
  introText: string | null;
  profiles: SiteData["profiles"];
  candidateName: string;
  partyName: string | null;
  profileImageUrl: string | null;
  sectionTitle?: string;
}

function TimelineItem({
  item,
}: {
  item: SiteData["profiles"][number];
}) {
  return (
    <li className="relative pl-7 pb-5 last:pb-0">
      {/* Timeline line */}
      <span className="absolute left-[5px] top-0 h-full w-0.5 bg-gray-200" />
      {/* Dot */}
      <span
        className="absolute left-0 top-1 h-3 w-3 rounded-full border-2 z-10"
        style={{
          borderColor: "var(--primary)",
          backgroundColor: item.isCurrent ? "var(--primary)" : "white",
        }}
      />
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-gray-800 sm:text-base leading-snug">
          {item.title}
        </p>
        {item.isCurrent && (
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--primary)" }}
          >
            현재
          </span>
        )}
      </div>
    </li>
  );
}

export default function ElectionProfile({
  introText,
  profiles,
  candidateName,
  partyName,
  profileImageUrl,
  sectionTitle,
}: Props) {
  const education = profiles
    .filter((p) => p.type === "education")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const career = profiles
    .filter((p) => p.type === "career")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (!introText && profiles.length === 0) return null;

  return (
    <section id="about" className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
      {/* Section heading */}
      <div className="mb-10 text-center">
        <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
          {sectionTitle || "후보 소개"}
        </h2>
      </div>

      {/* Intro text */}
      {introText && (
        <div className="mx-auto mb-12 max-w-2xl text-center text-gray-600 leading-relaxed text-base sm:text-lg">
          {introText.split("\n").map((line, i) => (
            <p key={i} className={i > 0 ? "mt-3" : ""}>
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Profile photo (별도 인물 사진) */}
      {profileImageUrl && (
        <div className="mx-auto mb-12 flex flex-col items-center">
          <div className="relative h-40 w-40 sm:h-48 sm:w-48 overflow-hidden rounded-full shadow-lg border-4 border-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={profileImageUrl}
              alt={candidateName}
              className="h-full w-full object-cover object-top"
            />
          </div>
          <div className="mt-4 text-center">
            <p className="text-xl font-bold text-gray-900">{candidateName}</p>
            {partyName && (
              <p className="text-sm font-medium" style={{ color: "var(--primary)" }}>
                {partyName}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Timelines */}
      <div className="grid gap-10 sm:grid-cols-2">
        {education.length > 0 && (
          <div className="rounded-2xl bg-gray-50 p-6">
            <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-gray-900">
              <svg className="h-5 w-5" style={{ color: "var(--primary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" />
              </svg>
              학력
            </h3>
            <ul className="relative">
              {education.map((item) => (
                <TimelineItem key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}

        {career.length > 0 && (
          <div className="rounded-2xl bg-gray-50 p-6">
            <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-gray-900">
              <svg className="h-5 w-5" style={{ color: "var(--primary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              주요 경력
            </h3>
            <ul className="relative">
              {career.map((item) => (
                <TimelineItem key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
