/**
 * 업로드 파일 서빙 Route Handler.
 *
 * Next.js standalone 모드는 컨테이너 시작 이후 추가된 public/ 파일을 자동 서빙하지
 * 않음(빌드 시점에 매니페스트가 고정됨). 런타임 업로드(/uploads/*)는 이 핸들러가
 * 디스크에서 직접 읽어 응답한다.
 *
 * 공개 접근 허용 — 후보 홈페이지가 <img> 태그로 가져가기 때문.
 * 로그인 필요 X. 단, path-traversal만 엄격히 차단.
 */
import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segs } = await params;
  if (!segs || segs.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  const uploadsDir = path.resolve(process.cwd(), "public", "uploads");
  const filePath = path.resolve(uploadsDir, ...segs);

  // path-traversal 방지 — 해결된 경로가 uploadsDir 하위여야 함
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
