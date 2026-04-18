import type { SiteData } from "@/types/site";
import ElectionHero from "./election-hero";
import ElectionKeywords from "./election-keywords";
import ElectionProfile from "./election-profile";
import ElectionPledges from "./election-pledges";
import ElectionGallery from "./election-gallery";
import ElectionSchedule from "./election-schedule";
import ElectionNews from "./election-news";
import ElectionVideos from "./election-videos";
import ElectionBlog from "./election-blog";
import ElectionContacts from "./election-contacts";
import ElectionFooter from "./election-footer";
import ElectionNav from "./election-nav";
import TrackingScript from "@/components/templates/tracking-script";

interface Props {
  data: SiteData;
}

export default function ElectionTemplate({ data }: Props) {
  const { user, settings, blocks } = data;

  // Helper: find a block by type and return its title
  function blockTitle(type: string): string | undefined {
    return blocks?.find((b) => b.type === type)?.title ?? undefined;
  }

  // Helper: get block content field
  function blockContent(type: string): Record<string, unknown> | null | undefined {
    return blocks?.find((b) => b.type === type)?.content;
  }

  // Extract hero button customization from hero block content
  const heroContent = blockContent("hero");
  const heroButtonProps = {
    button1Text: heroContent?.button1Text as string | undefined,
    button1Link: heroContent?.button1Link as string | undefined,
    button2Text: heroContent?.button2Text as string | undefined,
    button2Link: heroContent?.button2Link as string | undefined,
    badgeFontSize: (heroContent?.badgeFontSize as number) || 12,
    electionFontSize: (heroContent?.electionFontSize as number) || 12,
  };

  // If blocks are defined and non-empty, render in block order
  const hasBlocks = blocks && blocks.length > 0;

  if (!hasBlocks) {
    // Default order (backward compatible)
    return (
      <div
        className="min-h-screen bg-white text-gray-900"
        style={
          {
            "--primary": settings.primaryColor,
            "--accent": settings.accentColor,
          } as React.CSSProperties
        }
      >
        <ElectionHero settings={settings} candidateName={user.name} />

        <ElectionKeywords pledges={data.pledges} />

        <ElectionProfile
          introText={settings.introText}
          profiles={data.profiles}
          candidateName={user.name}
          partyName={settings.partyName}
          profileImageUrl={settings.profileImageUrl}
        />

        <ElectionPledges pledges={data.pledges} />

        <ElectionGallery gallery={data.gallery} />

        <ElectionSchedule schedules={data.schedules} />

        <ElectionNews news={data.news} />

        <ElectionVideos videos={data.videos} />

        <ElectionContacts
          contacts={data.contacts}
          kakaoAppKey={settings.kakaoAppKey}
        />

        <ElectionFooter settings={settings} candidateName={user.name} />

        <ElectionNav blocks={blocks} />

        <TrackingScript code={user.code} />
      </div>
    );
  }

  // Block-based rendering
  const renderedProfileRef = { rendered: false };

  const sectionMap: Record<string, () => React.ReactNode> = {
    hero: () => (
      <ElectionHero
        key="hero"
        settings={settings}
        candidateName={user.name}
        {...heroButtonProps}
      />
    ),
    keywords: () => <ElectionKeywords key="keywords" pledges={data.pledges} />,
    intro: () => {
      if (renderedProfileRef.rendered) return null;
      renderedProfileRef.rendered = true;
      // Combine title from intro or career block, prefer intro
      const title = blockTitle("intro") || blockTitle("career");
      return (
        <ElectionProfile
          key="profile"
          introText={settings.introText}
          profiles={data.profiles}
          candidateName={user.name}
          partyName={settings.partyName}
          profileImageUrl={settings.profileImageUrl}
          sectionTitle={title}
        />
      );
    },
    career: () => {
      if (renderedProfileRef.rendered) return null;
      renderedProfileRef.rendered = true;
      const title = blockTitle("career") || blockTitle("intro");
      return (
        <ElectionProfile
          key="profile"
          introText={settings.introText}
          profiles={data.profiles}
          candidateName={user.name}
          partyName={settings.partyName}
          profileImageUrl={settings.profileImageUrl}
          sectionTitle={title}
        />
      );
    },
    goals: () => (
      <ElectionPledges
        key="pledges"
        pledges={data.pledges}
        sectionTitle={blockTitle("goals")}
      />
    ),
    gallery: () => (
      <ElectionGallery
        key="gallery"
        gallery={data.gallery}
        sectionTitle={blockTitle("gallery")}
      />
    ),
    schedule: () => {
      const schedContent = blockContent("schedule");
      const schedColors = (schedContent?.colors as Record<string, string>) || {};
      return (
        <ElectionSchedule
          key="schedule"
          schedules={data.schedules}
          sectionTitle={blockTitle("schedule")}
          colors={schedColors}
        />
      );
    },
    news: () => {
      const newsContent = blockContent("news");
      return (
        <ElectionNews
          key="news"
          news={data.news}
          sectionTitle={blockTitle("news")}
          showCount={(newsContent?.showCount as number) || 3}
        />
      );
    },
    videos: () => {
      const videosContent = blockContent("videos");
      return (
        <ElectionVideos
          key="videos"
          videos={data.videos}
          sectionTitle={blockTitle("videos")}
          showCount={(videosContent?.showCount as number) || 4}
        />
      );
    },
    blog: () => (
      <ElectionBlog
        key="blog"
        code={user.code}
        sectionTitle={blockTitle("blog")}
        showCount={(blockContent("blog")?.showCount as number) || 6}
      />
    ),
    donation: () => {
      const donationContent = blockContent("donation");
      const imageUrl = donationContent?.imageUrl as string | undefined;
      const description = donationContent?.description as string | undefined;
      if (!imageUrl) return null;
      return (
        <section key="donation" id="donation" className="bg-gray-50 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-6">
            <div className="mb-10 text-center">
              <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
                {blockTitle("donation") || "후원 안내"}
              </h2>
              {description && (
                <p className="mt-3 text-sm text-gray-600 whitespace-pre-line">{description}</p>
              )}
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="후원 안내" className="w-full rounded-xl" loading="lazy" />
            </div>
          </div>
        </section>
      );
    },
    contacts: () => (
      <ElectionContacts
        key="contacts"
        contacts={data.contacts}
        kakaoAppKey={settings.kakaoAppKey}
        sectionTitle={blockTitle("contacts")}
      />
    ),
  };

  return (
    <div
      className="min-h-screen bg-white text-gray-900"
      style={
        {
          "--primary": settings.primaryColor,
          "--accent": settings.accentColor,
        } as React.CSSProperties
      }
    >
      {blocks.map((block) => {
        const renderer = sectionMap[block.type];
        if (!renderer) return null;
        return renderer();
      })}

      <ElectionFooter settings={settings} candidateName={user.name} />

      <ElectionNav blocks={blocks} />

      <TrackingScript code={user.code} />
    </div>
  );
}
