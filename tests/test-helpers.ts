import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TEST_DIR = path.join(__dirname, '..');
export const TEST_DATA_DIR = path.join(TEST_DIR, 'tests', 'data');
export const TEST_OUTPUT_DIR = path.join(TEST_DIR, '.test-output');

// Test URLs
export const STAGING_URL = 'https://witty-bay-02b5a9c0f.1.azurestaticapps.net';
export const TEST_TIMEOUT = 60000;

export function ensureTestDir(): void {
  if (!fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  }
}

export function cleanTestDir(): void {
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
}

export function createTestFile(name: string, content: unknown): string {
  ensureTestDir();
  const filePath = path.join(TEST_OUTPUT_DIR, name);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

export function readTestFile<T>(name: string): T | null {
  const filePath = path.join(TEST_OUTPUT_DIR, name);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}
