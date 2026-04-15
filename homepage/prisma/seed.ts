import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SUPER_ADMIN_INITIAL_PASSWORD || "admin1234";
  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  // 1. 슈퍼 관리자
  await prisma.superAdmin.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: hashedPassword,
      name: "시스템 관리자",
    },
  });
  console.log("✓ 슈퍼 관리자 생성 완료 (admin / admin1234)");

  // 2. 데모 사용자
  const demoPassword = await bcrypt.hash("demo1234", 12);
  const demoUser = await prisma.user.upsert({
    where: { code: "demo" },
    update: {},
    create: {
      code: "demo",
      name: "김민수",
      email: "demo@myhome.kr",
      phone: "010-1234-5678",
      passwordHash: demoPassword,
      plan: "premium",
      templateType: "election",
      templateTheme: "default",
      isActive: true,
      memo: "데모 계정",
    },
  });
  console.log("✓ 데모 사용자 생성 완료 (demo / demo1234)");

  // 3. 사이트 설정
  await prisma.siteSetting.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      ogTitle: "김민수 — 더 나은 내일을 약속합니다",
      ogDescription: "제22대 서울시 강남구 시의원 후보 김민수입니다.",
      heroSlogan: "더 나은 내일을\n약속합니다",
      heroSubSlogan: "주민과 함께하는 정치, 김민수가 실현합니다",
      partyName: "국민의힘",
      positionTitle: "서울시 강남구 시의원 후보",
      subtitle: "함께 만드는 살기 좋은 강남",
      introText:
        "안녕하세요, 강남구 시의원 후보 김민수입니다.\n20년간 지역사회를 위해 봉사하며, 주민 여러분의 목소리에 귀 기울여 왔습니다.\n이번에는 시의원으로서 더 큰 변화를 만들겠습니다.",
      primaryColor: "#C9151E",
      accentColor: "#1A56DB",
      electionDate: new Date("2026-06-03"),
      electionName: "제22대 전국동시지방선거",
    },
  });
  console.log("✓ 사이트 설정 생성 완료");

  // 4. 프로필 (학력/경력)
  const profiles = [
    { type: "education", title: "서울대학교 행정학과 졸업", sortOrder: 0 },
    { type: "education", title: "서울대학교 대학원 행정학 석사", sortOrder: 1 },
    { type: "career", title: "강남구청 주민자치위원회 위원장", isCurrent: true, sortOrder: 0 },
    { type: "career", title: "강남구 도시재생 추진위원", sortOrder: 1 },
    { type: "career", title: "사단법인 강남발전연구소 이사", sortOrder: 2 },
  ];
  for (const p of profiles) {
    await prisma.profile.create({
      data: { userId: demoUser.id, ...p },
    });
  }
  console.log("✓ 프로필 5개 생성 완료");

  // 5. 공약
  const pledges = [
    {
      icon: "solar:buildings-bold",
      title: "안전한 주거환경 조성",
      description: "노후 건물 안전 점검 의무화 및 주거 환경 개선 지원",
      details: JSON.stringify(["노후 건물 정밀 안전진단 확대", "주거 환경 개선 보조금 지원", "소방시설 현대화"]),
      sortOrder: 0,
    },
    {
      icon: "solar:bus-bold",
      title: "대중교통 확충",
      description: "출퇴근 시간 버스 배차 간격 단축 및 심야 노선 확대",
      details: JSON.stringify(["버스 배차 간격 30% 단축", "심야 버스 3개 노선 신설", "어르신 교통비 지원 확대"]),
      sortOrder: 1,
    },
    {
      icon: "solar:graduation-cap-bold",
      title: "교육 환경 개선",
      description: "방과 후 돌봄 시설 확충 및 청소년 문화 공간 조성",
      details: JSON.stringify(["초등 돌봄교실 전 학교 확대", "청소년 문화센터 신설", "학교 주변 안전 CCTV 확충"]),
      sortOrder: 2,
    },
  ];
  for (const p of pledges) {
    await prisma.pledge.create({
      data: { userId: demoUser.id, ...p },
    });
  }
  console.log("✓ 공약 3개 생성 완료");

  // 6. 일정
  await prisma.schedule.createMany({
    data: [
      { userId: demoUser.id, title: "강남역 거리 유세", date: new Date("2026-05-25"), time: "09:00", location: "강남역 11번 출구" },
      { userId: demoUser.id, title: "주민 간담회", date: new Date("2026-05-28"), time: "14:00", location: "강남구민회관" },
      { userId: demoUser.id, title: "청년 토론회", date: new Date("2026-05-30"), time: "19:00", location: "강남 청년센터" },
    ],
  });
  console.log("✓ 일정 3개 생성 완료");

  // 7. 연락처
  await prisma.contact.createMany({
    data: [
      { userId: demoUser.id, type: "phone", label: "선거사무소", value: "02-555-1234", sortOrder: 0 },
      { userId: demoUser.id, type: "email", label: "이메일", value: "minsu@example.com", sortOrder: 1 },
      { userId: demoUser.id, type: "instagram", label: "인스타그램", value: "@minsu_kim", url: "https://instagram.com/minsu_kim", sortOrder: 2 },
      { userId: demoUser.id, type: "youtube", label: "유튜브", value: "김민수TV", url: "https://youtube.com/@minsu", sortOrder: 3 },
    ],
  });
  console.log("✓ 연락처 4개 생성 완료");

  // 8. 영상 (YouTube)
  await prisma.video.createMany({
    data: [
      { userId: demoUser.id, videoId: "dQw4w9WgXcQ", title: "김민수 후보 출마 선언 기자회견", sortOrder: 0 },
      { userId: demoUser.id, videoId: "9bZkp7q19f0", title: "강남구 발전 비전 발표", sortOrder: 1 },
      { userId: demoUser.id, videoId: "kJQP7kiw5Fk", title: "주민 간담회 현장 영상", sortOrder: 2 },
    ],
  });
  console.log("✓ 영상 3개 생성 완료");

  // 9. 관련 기사
  await prisma.news.createMany({
    data: [
      {
        userId: demoUser.id,
        title: "김민수 후보, 강남구 안전 주거환경 공약 발표",
        source: "서울경제",
        url: "https://example.com/news/1",
        publishedDate: new Date("2026-03-15"),
        sortOrder: 0,
      },
      {
        userId: demoUser.id,
        title: "강남구 시의원 예비후보 김민수, 대중교통 확충안 제시",
        source: "한국일보",
        url: "https://example.com/news/2",
        publishedDate: new Date("2026-03-10"),
        sortOrder: 1,
      },
      {
        userId: demoUser.id,
        title: "김민수 예비후보 \"교육환경 개선이 최우선 과제\"",
        source: "강남구민일보",
        url: "https://example.com/news/3",
        publishedDate: new Date("2026-03-05"),
        sortOrder: 2,
      },
      {
        userId: demoUser.id,
        title: "6·3 지방선거 강남구 시의원 출마 예비후보자 현황",
        source: "뉴스1",
        url: "https://example.com/news/4",
        publishedDate: new Date("2026-02-28"),
        sortOrder: 3,
      },
    ],
  });
  console.log("✓ 기사 4개 생성 완료");

  // 10. 사진첩
  await prisma.gallery.createMany({
    data: [
      { userId: demoUser.id, url: "https://picsum.photos/seed/campaign1/800/600", altText: "거리 유세 현장", category: "campaign", sortOrder: 0 },
      { userId: demoUser.id, url: "https://picsum.photos/seed/campaign2/800/600", altText: "지지자와 함께", category: "campaign", sortOrder: 1 },
      { userId: demoUser.id, url: "https://picsum.photos/seed/event1/800/600", altText: "주민 간담회", category: "event", sortOrder: 2 },
      { userId: demoUser.id, url: "https://picsum.photos/seed/event2/800/600", altText: "청년 토론회", category: "event", sortOrder: 3 },
      { userId: demoUser.id, url: "https://picsum.photos/seed/media1/800/600", altText: "기자회견", category: "media", sortOrder: 4 },
      { userId: demoUser.id, url: "https://picsum.photos/seed/activity1/800/600", altText: "봉사활동", category: "activity", sortOrder: 5 },
      { userId: demoUser.id, url: "https://picsum.photos/seed/activity2/800/600", altText: "지역 방문", category: "activity", sortOrder: 6 },
      { userId: demoUser.id, url: "https://picsum.photos/seed/media2/800/600", altText: "인터뷰", category: "media", sortOrder: 7 },
    ],
  });
  console.log("✓ 사진 8장 생성 완료");

  // 11. 블록 (demo 사용자)
  const demoBlockTypes = ["hero", "intro", "career", "goals", "gallery", "schedule", "news", "videos", "contacts"];
  for (let i = 0; i < demoBlockTypes.length; i++) {
    await prisma.block.create({
      data: {
        userId: demoUser.id,
        type: demoBlockTypes[i],
        visible: true,
        sortOrder: i,
      },
    });
  }
  console.log("✓ 데모 사용자 블록 9개 생성 완료");

  // 12. 테스트 사용자 (test)
  const testPassword = await bcrypt.hash("test1234", 12);
  const testUser = await prisma.user.upsert({
    where: { code: "test" },
    update: {},
    create: {
      code: "test",
      name: "테스트",
      email: "test@myhome.kr",
      phone: "010-9999-0000",
      passwordHash: testPassword,
      plan: "basic",
      templateType: "election",
      templateTheme: "default",
      isActive: true,
      memo: "테스트 계정",
    },
  });
  console.log("✓ 테스트 사용자 생성 완료 (test / test1234)");

  // 13. 테스트 사용자 사이트 설정
  await prisma.siteSetting.upsert({
    where: { userId: testUser.id },
    update: {},
    create: {
      userId: testUser.id,
      ogTitle: "테스트 홈페이지",
      ogDescription: "테스트용 페이지입니다.",
      heroSlogan: "안녕하세요",
      heroSubSlogan: "테스트 페이지에 오신 것을 환영합니다",
      positionTitle: "테스트 사용자",
      subtitle: "테스트 페이지",
      introText: "이것은 테스트용 페이지입니다. 다양한 블록 기능을 테스트할 수 있습니다.",
      primaryColor: "#3B82F6",
      accentColor: "#10B981",
    },
  });
  console.log("✓ 테스트 사이트 설정 생성 완료");

  // 14. 테스트 사용자 프로필
  const testProfiles = [
    { type: "education", title: "한국대학교 컴퓨터공학과 졸업", sortOrder: 0 },
    { type: "career", title: "테스트 회사 개발팀장", isCurrent: true, sortOrder: 0 },
    { type: "career", title: "이전 회사 소프트웨어 엔지니어", sortOrder: 1 },
  ];
  for (const p of testProfiles) {
    await prisma.profile.create({
      data: { userId: testUser.id, ...p },
    });
  }
  console.log("✓ 테스트 프로필 3개 생성 완료");

  // 15. 테스트 사용자 공약
  const testPledges = [
    {
      icon: "solar:star-bold",
      title: "첫 번째 목표",
      description: "테스트용 첫 번째 목표입니다",
      details: JSON.stringify(["세부 항목 1", "세부 항목 2"]),
      sortOrder: 0,
    },
    {
      icon: "solar:heart-bold",
      title: "두 번째 목표",
      description: "테스트용 두 번째 목표입니다",
      details: JSON.stringify(["세부 항목 A", "세부 항목 B"]),
      sortOrder: 1,
    },
  ];
  for (const p of testPledges) {
    await prisma.pledge.create({
      data: { userId: testUser.id, ...p },
    });
  }
  console.log("✓ 테스트 공약 2개 생성 완료");

  // 16. 테스트 사용자 사진첩
  await prisma.gallery.createMany({
    data: [
      { userId: testUser.id, url: "https://picsum.photos/seed/test1/800/600", altText: "테스트 이미지 1", category: "activity", sortOrder: 0 },
      { userId: testUser.id, url: "https://picsum.photos/seed/test2/800/600", altText: "테스트 이미지 2", category: "activity", sortOrder: 1 },
    ],
  });
  console.log("✓ 테스트 사진 2장 생성 완료");

  // 17. 테스트 사용자 일정
  await prisma.schedule.createMany({
    data: [
      { userId: testUser.id, title: "테스트 일정 1", date: new Date("2026-04-15"), time: "10:00", location: "테스트 장소" },
      { userId: testUser.id, title: "테스트 일정 2", date: new Date("2026-04-20"), time: "14:00", location: "회의실" },
    ],
  });
  console.log("✓ 테스트 일정 2개 생성 완료");

  // 18. 테스트 사용자 연락처
  await prisma.contact.createMany({
    data: [
      { userId: testUser.id, type: "phone", label: "전화", value: "010-9999-0000", sortOrder: 0 },
      { userId: testUser.id, type: "email", label: "이메일", value: "test@myhome.kr", sortOrder: 1 },
    ],
  });
  console.log("✓ 테스트 연락처 2개 생성 완료");

  // 19. 테스트 사용자 뉴스
  await prisma.news.createMany({
    data: [
      { userId: testUser.id, title: "테스트 뉴스 기사", source: "테스트 뉴스", url: "https://example.com/test-news", publishedDate: new Date("2026-03-20"), sortOrder: 0 },
    ],
  });
  console.log("✓ 테스트 뉴스 1개 생성 완료");

  // 20. 테스트 사용자 영상
  await prisma.video.createMany({
    data: [
      { userId: testUser.id, videoId: "dQw4w9WgXcQ", title: "테스트 영상", sortOrder: 0 },
    ],
  });
  console.log("✓ 테스트 영상 1개 생성 완료");

  // 21. 테스트 사용자 블록
  const testBlockTypes = ["hero", "intro", "career", "goals", "gallery", "schedule", "news", "videos", "contacts", "links"];
  for (let i = 0; i < testBlockTypes.length; i++) {
    await prisma.block.create({
      data: {
        userId: testUser.id,
        type: testBlockTypes[i],
        visible: true,
        sortOrder: i,
      },
    });
  }
  console.log("✓ 테스트 사용자 블록 10개 생성 완료");

  // 22. kim 사용자 블록 (존재하는 경우)
  const kimUser = await prisma.user.findUnique({ where: { code: "kim" } });
  if (kimUser) {
    const kimBlockTypes = ["hero", "intro", "career", "goals", "gallery", "schedule", "news", "videos", "contacts"];
    const existingKimBlocks = await prisma.block.findFirst({ where: { userId: kimUser.id } });
    if (!existingKimBlocks) {
      for (let i = 0; i < kimBlockTypes.length; i++) {
        await prisma.block.create({
          data: {
            userId: kimUser.id,
            type: kimBlockTypes[i],
            visible: true,
            sortOrder: i,
          },
        });
      }
      console.log("✓ kim 사용자 블록 9개 생성 완료");
    } else {
      console.log("✓ kim 사용자 블록 이미 존재 - 스킵");
    }
  } else {
    console.log("ℹ kim 사용자가 없습니다 - 블록 생성 스킵");
  }

  // 23. 시스템 설정
  const settings = [
    { key: "max_file_size_basic", value: 104857600 },
    { key: "max_file_size_premium", value: 2147483648 },
    { key: "max_images_basic", value: 50 },
    { key: "max_images_premium", value: 500 },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }
  console.log("✓ 시스템 설정 4개 생성 완료");

  console.log("\n🎉 시드 완료!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
