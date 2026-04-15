import sharp from "sharp";

/**
 * Hero image: max 1600px wide, WebP 85%
 */
export async function processHeroImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

/**
 * Gallery image: max 1200px wide, WebP 85%
 */
export async function processGalleryImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

/**
 * OG image: exactly 1200x630, WebP 85%
 */
export async function processOgImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 1200, height: 630, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .webp({ quality: 90 })
    .toBuffer();
}

/**
 * Thumbnail: 400px wide, WebP 85%
 */
export async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}
