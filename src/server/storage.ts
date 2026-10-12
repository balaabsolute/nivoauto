import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * File storage adapter for job photos. Default: local disk under UPLOAD_DIR (./uploads).
 * For serverless / multi-instance deployments, replace with an object store (S3, GCS, Azure Blob)
 * implementing the same two functions. See docs/DEPLOYMENT.md.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 8) * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
]);

export async function saveUpload(prefix: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<string> {
  const ext = ALLOWED.get(file.type);
  if (!ext) throw new Error("Only JPEG, PNG, WebP or HEIC photos are accepted");
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`Photo exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const key = `${prefix.replace(/[^a-zA-Z0-9/_-]/g, "")}/${randomUUID()}${ext}`;
  const full = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, file.bytes);
  return key;
}

export async function readUpload(key: string): Promise<Buffer | null> {
  const full = path.resolve(UPLOAD_DIR, key);
  if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return null; // path traversal guard
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}
