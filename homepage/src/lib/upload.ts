import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

// Magic bytes for each image format
const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF
  "image/gif": [0x47, 0x49, 0x46],
};

// Maximum single-file upload size: 10 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Validates file by size, MIME type, extension, and magic bytes (4-layer check).
 */
export function validateFile(
  buffer: Buffer,
  mimeType: string,
  originalName: string
): { valid: boolean; error?: string } {
  // 0. File size check
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `파일 크기가 제한을 초과했습니다 (최대 ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
    };
  }

  // 1. MIME type check
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `허용되지 않는 파일 형식입니다: ${mimeType}`,
    };
  }

  // 2. Extension check
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `허용되지 않는 확장자입니다: ${ext}`,
    };
  }

  // 3. Magic bytes check
  const expectedBytes = MAGIC_BYTES[mimeType];
  if (expectedBytes) {
    for (let i = 0; i < expectedBytes.length; i++) {
      if (buffer[i] !== expectedBytes[i]) {
        return {
          valid: false,
          error: "파일 내용이 선언된 형식과 일치하지 않습니다",
        };
      }
    }
  }

  return { valid: true };
}

/**
 * 업로드 URL은 /api/site/uploads/... 로 서빙.
 * NPM은 /api/site/* 를 ep_homepage로 라우팅하고, Route Handler가 public/uploads/에서
 * 런타임에 파일을 직접 읽어 응답. Next.js standalone은 시작 후 추가된 public 파일을
 * 자동 서빙하지 않기 때문에 일반 정적 경로는 쓸 수 없음.
 */
const URL_PREFIX = "/api/site/uploads";

/**
 * Saves a processed image buffer to disk.
 * Returns the web-accessible URL (/_mh_assets/uploads/userCode/type/filename.webp).
 */
export async function saveFile(
  buffer: Buffer,
  userCode: string,
  type: string
): Promise<string> {
  const dir = path.join(process.cwd(), "public", "uploads", userCode, type);
  await fs.mkdir(dir, { recursive: true });

  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  const filename = `${timestamp}-${random}.webp`;

  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);

  return `${URL_PREFIX}/${userCode}/${type}/${filename}`;
}

/**
 * Deletes a file from disk given its web URL or legacy relative path.
 * Supports both `/_mh_assets/uploads/...` (new) and `/uploads/...` (legacy).
 */
export async function deleteFile(storedUrl: string): Promise<void> {
  // 새 URL(/api/site/uploads/...) → 디스크 경로(public/uploads/...)로 역매핑
  // 레거시 /_mh_assets/uploads/... 와 /uploads/... 도 모두 지원 (과거 업로드 호환)
  let relativePath = storedUrl;
  if (relativePath.startsWith(URL_PREFIX + "/")) {
    relativePath = "/uploads" + relativePath.slice(URL_PREFIX.length);
  } else if (relativePath.startsWith("/_mh_assets/uploads/")) {
    relativePath = "/uploads" + relativePath.slice("/_mh_assets/uploads".length);
  }

  const uploadsDir = path.resolve(process.cwd(), "public", "uploads");
  const filePath = path.resolve(process.cwd(), "public", relativePath);

  // Prevent path traversal: resolved path must be inside uploads directory
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    throw new Error("Invalid file path");
  }

  try {
    await fs.unlink(filePath);
  } catch {
    // File may already be deleted — ignore
  }
}
