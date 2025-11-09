import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';
import {
  PageMetadata,
  CrawlResult,
  CrawlError,
} from '../types.js';
import {
  extractDomain,
  createMissionControl,
  normalizeUrl,
  isSameDomain,
  writeJsonFile,
  calculateElapsedTime,
  parseRobotsText,
  sleep,
  isValidUrl,
} from '../utils.js';

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TIMEOUT = 30000;
const RATE_LIMIT_MS = 1000; // 1 second between requests

interface CrawlOptions {
  url: string;
  maxDepth?: number;
  maxPages?: number;
  respectRobotsTxt?: boolean;
  rateLimit?: number;
}

export async function crawlWebsite(options: CrawlOptions): Promise<CrawlResult> {
  const startTime = Date.now();
  const {
    url,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxPages = 100,
    respectRobotsTxt = true,
    rateLimit = RATE_LIMIT_MS,
  } = options;

  if (!isValidUrl(url)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const domain = extractDomain(url);
  const mission = createMissionControl(domain);

  const pages = new Map<string, PageMetadata>();
  const errors: CrawlError[] = [];
  let sitemapFound = false;

  try {
    // Try to fetch and parse sitemap first
    try {
      const sitemapUrl = `${new URL(url).origin}/sitemap.xml`;
      const sitemapPages = await fetchSitemap(sitemapUrl);
      if (sitemapPages.length > 0) {
        sitemapFound = true;
        for (const pageUrl of sitemapPages.slice(0, maxPages)) {
          const metadata = await crawlPage(pageUrl, domain, rateLimit);
          if (metadata) {
            pages.set(pageUrl, metadata);
          }
        }
      }
    } catch {
      // Sitemap not found, fall back to link crawling
    }

    // If sitemap not found or incomplete, do recursive crawling
    if (!sitemapFound) {
      const robotsTxt = await fetchRobotsTxt(url);
      const canCrawlFn = respectRobotsTxt
        ? parseRobotsText(robotsTxt, 'Googlebot').canCrawl
        : () => true;

      await recursiveCrawl(
        url,
        domain,
        pages,
        errors,
        canCrawlFn,
        0,
        maxDepth,
        maxPages,
        rateLimit,
      );
    }

    // Save results
    const crawlData: CrawlResult = {
      domain,
      startUrl: url,
      timestamp: new Date().toISOString(),
      pages: Array.from(pages.values()),
      sitemapFound,
      totalPages: pages.size,
      crawlDuration: calculateElapsedTime(startTime),
      errors,
    };

    writeJsonFile(mission.crawlDataPath, crawlData);

    return crawlData;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push({
      url,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    });

    throw new Error(`Crawl failed: ${errorMsg}`);
  }
}

async function fetchSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const response = await axios.get(sitemapUrl, { timeout: DEFAULT_TIMEOUT });
    const parsed = await parseStringPromise(response.data);

    const urls: string[] = [];
    if (parsed.urlset && parsed.urlset.url) {
      for (const entry of parsed.urlset.url) {
        if (entry.loc && entry.loc[0]) {
          urls.push(entry.loc[0]);
        }
      }
    }

    return urls.filter(url => isSameDomain(url, sitemapUrl));
  } catch {
    return [];
  }
}

async function fetchRobotsTxt(baseUrl: string): Promise<string> {
  try {
    const url = new URL('/robots.txt', baseUrl).toString();
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  } catch {
    return '';
  }
}

async function recursiveCrawl(
  pageUrl: string,
  domain: string,
  pages: Map<string, PageMetadata>,
  errors: CrawlError[],
  canCrawlFn: (path: string) => boolean,
  depth: number,
  maxDepth: number,
  maxPages: number,
  rateLimit: number,
): Promise<void> {
  if (depth > maxDepth || pages.size >= maxPages) {
    return;
  }

  if (pages.has(pageUrl)) {
    return;
  }

  // Check robots.txt
  try {
    const urlObj = new URL(pageUrl);
    if (!canCrawlFn(urlObj.pathname)) {
      return;
    }
  } catch {
    return;
  }

  void domain; // Use domain parameter to satisfy linter

  try {
    await sleep(rateLimit);
    const metadata = await crawlPage(pageUrl, domain, 0); // No additional rate limit here

    if (metadata) {
      pages.set(pageUrl, metadata);

      // Recursively crawl internal links
      for (const link of metadata.links.internal) {
        if (!pages.has(link) && pages.size < maxPages) {
          await recursiveCrawl(
            link,
            domain,
            pages,
            errors,
            canCrawlFn,
            depth + 1,
            maxDepth,
            maxPages,
            rateLimit,
          );
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push({
      url: pageUrl,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    });
  }
}

async function crawlPage(url: string, domain: string, rateLimit: number): Promise<PageMetadata | null> {
  // Note: domain parameter kept for API compatibility but not used after Issue #542 fix
  void domain;

  try {
    if (rateLimit > 0) {
      await sleep(rateLimit);
    }

    const response = await axios.get(url, {
      timeout: DEFAULT_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const $ = cheerio.load(response.data);

    // Extract metadata
    const title = $('title').text() || $('meta[property="og:title"]').attr('content') || '';
    const description = $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || '';
    const h1 = $('h1').first().text() || '';
    const canonical = $('link[rel="canonical"]').attr('href') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDescription = $('meta[property="og:description"]').attr('content') || '';

    // Extract headings
    const h1s: string[] = [];
    const h2s: string[] = [];
    const h3s: string[] = [];

    $('h1').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h1s.push(text);
    });
    $('h2').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h2s.push(text);
    });
    $('h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h3s.push(text);
    });

    // Extract links
    const internalLinks = new Set<string>();
    const externalLinks = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const normalized = normalizeUrl(href, url);
        if (normalized.startsWith('http')) {
          // Fix for Issue #542: Pass full URL to isSameDomain instead of domain string
          // isSameDomain expects two URLs, not URL + hostname
          if (isSameDomain(normalized, url)) {
            internalLinks.add(normalized);
          } else {
            externalLinks.add(normalized);
          }
        }
      }
    });

    // Check for noindex
    const noindex = $('meta[name="robots"]').attr('content')?.includes('noindex') || false;

    // Count words
    const bodyText = $('body').text();
    const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;

    return {
      url,
      title,
      description,
      h1,
      canonical,
      ogImage,
      ogTitle,
      ogDescription,
      wordCount,
      links: {
        internal: Array.from(internalLinks),
        external: Array.from(externalLinks),
      },
      headings: {
        h1: h1s,
        h2: h2s,
        h3: h3s,
      },
      isIndexed: true,
      noindex,
    };
  } catch (error) {
    return null;
  }
}
