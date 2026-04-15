export interface SiteData {
  user: { name: string; code: string; templateType: string; plan: string };
  settings: {
    ogTitle: string | null;
    ogDescription: string | null;
    ogImageUrl: string | null;
    heroImageUrl: string | null;
    profileImageUrl: string | null;
    heroSlogan: string | null;
    heroSubSlogan: string | null;
    partyName: string | null;
    positionTitle: string | null;
    subtitle: string | null;
    introText: string | null;
    primaryColor: string;
    accentColor: string;
    electionDate: string | null;
    electionName: string | null;
    kakaoAppKey: string | null;
  };
  profiles: Array<{
    id: number;
    type: string;
    title: string;
    isCurrent: boolean;
    sortOrder: number;
  }>;
  pledges: Array<{
    id: number;
    icon: string;
    title: string;
    description: string | null;
    details: string[] | { items: string[]; imageUrl?: string };
    sortOrder: number;
  }>;
  gallery: Array<{
    id: number;
    url: string;
    altText: string | null;
    category: string;
    sortOrder: number;
  }>;
  schedules: Array<{
    id: number;
    title: string;
    date: string;
    time: string | null;
    location: string | null;
  }>;
  contacts: Array<{
    id: number;
    type: string;
    label: string | null;
    value: string;
    url: string | null;
    sortOrder: number;
  }>;
  news: Array<{
    id: number;
    title: string;
    source: string | null;
    url: string | null;
    imageUrl: string | null;
    publishedDate: string | null;
    sortOrder: number;
  }>;
  videos: Array<{
    id: number;
    videoId: string;
    title: string | null;
    sortOrder: number;
  }>;
  blocks?: Array<{
    id: number;
    type: string;
    title: string | null;
    content: Record<string, unknown> | null;
    sortOrder: number;
  }>;
}
