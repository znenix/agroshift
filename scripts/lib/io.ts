/** File and logging helpers for the data scripts (run from the repository root via npm). */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { z } from "zod";

export const ROOT = process.cwd();
if (!existsSync(path.join(ROOT, "package.json")) || !existsSync(path.join(ROOT, "docs", "SPEC.md"))) {
  throw new Error(`Run the data scripts from the repository root (via npm run). Current directory: ${ROOT}`);
}

export const DATA_DIR = path.join(ROOT, "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const PUBLIC_DATA_DIR = path.join(ROOT, "public", "data");

export async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`${path.relative(ROOT, file)} is not valid:\n  ${issues.join("\n  ")}`);
  }
  return parsed.data;
}

/** The validated file, or `null` if it is missing, unreadable, invalid or older than `maxAgeDays`. */
export async function readJsonIfValid<T>(file: string, schema: z.ZodType<T>, maxAgeDays?: number): Promise<T | null> {
  try {
    if (maxAgeDays !== undefined) {
      const ageDays = (Date.now() - (await stat(file)).mtimeMs) / 86_400_000;
      if (ageDays > maxAgeDays) return null;
    }
    const parsed = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Writes JSON through a temporary file so an interrupted run never leaves a half-written file. */
export async function writeJsonAtomic(file: string, data: unknown, pretty = false): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, pretty ? 2 : undefined)}\n`, "utf8");
  await rename(temporary, file);
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function log(scope: string, message: string): void {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`${time} [${scope}] ${message}`);
}

export function relative(file: string): string {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}
