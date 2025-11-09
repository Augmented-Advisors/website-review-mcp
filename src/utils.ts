import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { MissionControl } from './types.js';

/**
 * Utility functions for website review tools
 */

export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/www\./, '');
  } catch {
    return 'unknown-domain';
  }
}

export function getReviewBaseDir(domain: string): string {
  const workDir = process.env.REVIEW_WORK_DIR || '/Users/craig/Code/core/.work/website-reviews';
  const domainSafe = domain.replace(/\./g, '-');
  return path.join(workDir, domainSafe);
}

export function createMissionControl(domain: string): MissionControl {
  const baseDir = getReviewBaseDir(domain);

  // Ensure directories exist
  ensureDir(baseDir);
  ensureDir(path.join(baseDir, 'screenshots'));
  ensureDir(path.join(baseDir, 'lighthouse'));
  ensureDir(path.join(baseDir, 'links'));
  ensureDir(path.join(baseDir, 'accessibility'));
  ensureDir(path.join(baseDir, 'baselines'));
  ensureDir(path.join(baseDir, 'diffs'));

  return {
    domain,
    baseDir,
    crawlDataPath: path.join(baseDir, 'crawl-results.json'),
    screenshotDir: path.join(baseDir, 'screenshots'),
    lighthouseDir: path.join(baseDir, 'lighthouse'),
    linksDir: path.join(baseDir, 'links'),
    accessibilityDir: path.join(baseDir, 'accessibility'),
    baselineDir: path.join(baseDir, 'baselines'),
    diffDir: path.join(baseDir, 'diffs'),
  };
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Normalize a URL by resolving it against a base URL.
 *
 * Follows WHATWG URL Standard resolution behavior (same as browsers):
 * - Absolute URLs (http://, https://) are returned as-is
 * - Absolute paths (/about) resolve to domain root: https://example.com/about
 * - Relative paths (contact, ../page) resolve relative to base URL directory:
 *   - 'contact' + 'https://example.com/page/' → 'https://example.com/page/contact'
 *   - '../about' + 'https://example.com/page/subpage/' → 'https://example.com/page/about'
 * - Fragments (#section) and queries (?id=1) append to base URL
 *
 * This matches browser link resolution for accurate web crawling.
 *
 * @param url - The URL to normalize (can be absolute, absolute path, or relative)
 * @param baseUrl - Optional base URL for resolving relative URLs
 * @returns Normalized absolute URL, or original URL if normalization fails
 */
export function normalizeUrl(url: string, baseUrl?: string): string {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (!baseUrl) {
      return url;
    }
    const base = new URL(baseUrl);
    if (url.startsWith('/')) {
      return `${base.protocol}//${base.host}${url}`;
    }
    if (url.startsWith('#') || url.startsWith('?')) {
      return `${baseUrl}${url}`;
    }
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

export function isSameDomain(url1: string, url2: string): boolean {
  try {
    const domain1 = new URL(url1).hostname;
    const domain2 = new URL(url2).hostname;
    return domain1 === domain2;
  } catch {
    return false;
  }
}

export function getPageSlug(url: string): string {
  try {
    const urlObj = new URL(url);
    let slug = urlObj.pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .replace(/\//g, '-')
      .replace(/\?.*$/, '');

    if (!slug) {
      slug = 'home';
    }

    // Replace special characters
    slug = slug
      .replace(/[^\w-]/g, '')
      .replace(/--+/g, '-');

    return slug;
  } catch {
    return 'page';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

export function calculateElapsedTime(startTime: number): number {
  return Math.round((Date.now() - startTime) / 1000);
}

export function parseRobotsText(robotsContent: string, userAgent = '*'): {
  canCrawl: (path: string) => boolean;
  canSitemap: boolean;
} {
  const lines = robotsContent.split('\n');
  let currentAgent = '';
  let allow: RegExp[] = [];
  let disallow: RegExp[] = [];
  let canSitemap = true;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('User-agent:')) {
      const agent = trimmed.replace('User-agent:', '').trim();
      if (agent === userAgent || agent === '*') {
        currentAgent = agent;
        allow = [];
        disallow = [];
      }
    } else if (currentAgent && trimmed.startsWith('Allow:')) {
      const path = trimmed.replace('Allow:', '').trim();
      if (path) {
        allow.push(new RegExp(`^${path.replace(/\*/g, '.*')}`));
      }
    } else if (currentAgent && trimmed.startsWith('Disallow:')) {
      const path = trimmed.replace('Disallow:', '').trim();
      if (path) {
        disallow.push(new RegExp(`^${path.replace(/\*/g, '.*')}`));
      }
    } else if (trimmed.startsWith('Sitemap:')) {
      canSitemap = true;
    }
  }

  return {
    canCrawl: (path: string) => {
      for (const pattern of disallow) {
        if (pattern.test(path)) {
          return false;
        }
      }
      for (const pattern of allow) {
        if (pattern.test(path)) {
          return true;
        }
      }
      return true;
    },
    canSitemap,
  };
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

export function getCurrentGitHash(): string {
  try {
    const { execSync } = require('child_process');
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' });
    return hash.trim();
  } catch {
    // Fallback to timestamp if not in git repo
    return `nogit-${Date.now()}`;
  }
}
