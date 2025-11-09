import axios, { AxiosError } from 'axios';
import * as path from 'path';
import {
  LinkStatus,
  BrokenLinkResult,
  PageMetadata,
} from '../types.js';
import {
  extractDomain,
  createMissionControl,
  writeJsonFile,
  calculateElapsedTime,
  readJsonFile,
  isSameDomain,
  sleep,
} from '../utils.js';

interface CheckLinksOptions {
  urls?: string[];
  domain?: string;
  useCrawlData?: boolean;
  checkExternal?: boolean;
  externalTimeout?: number;
  rateLimit?: number;
}

const DEFAULT_TIMEOUT = 10000;
const RATE_LIMIT_MS = 500;

export async function checkBrokenLinks(options: CheckLinksOptions): Promise<BrokenLinkResult> {
  const startTime = Date.now();
  const {
    urls = [],
    domain: providedDomain,
    useCrawlData = true,
    checkExternal = false,
    externalTimeout = DEFAULT_TIMEOUT,
    rateLimit = RATE_LIMIT_MS,
  } = options;

  let domain = providedDomain || '';

  // Determine domain
  if (urls.length > 0) {
    domain = extractDomain(urls[0]);
  } else if (useCrawlData && providedDomain) {
    domain = providedDomain;
  }

  if (!domain) {
    throw new Error('Must provide domain or URLs for link checking');
  }

  const mission = createMissionControl(domain);

  // Collect all links from crawl data
  let allLinks = new Set<string>();

  if (useCrawlData) {
    const crawlResult = readJsonFile<{ pages: PageMetadata[] }>(mission.crawlDataPath);
    if (crawlResult && crawlResult.pages) {
      for (const page of crawlResult.pages) {
        for (const link of page.links.internal) {
          allLinks.add(link);
        }
        if (checkExternal) {
          for (const link of page.links.external) {
            allLinks.add(link);
          }
        }
      }
    }
  }

  if (urls.length > 0) {
    for (const url of urls) {
      allLinks.add(url);
    }
  }

  if (allLinks.size === 0) {
    throw new Error('No links found to check');
  }

  const brokenLinks: LinkStatus[] = [];
  let workingCount = 0;

  console.log(`Checking ${allLinks.size} links...`);

  for (const url of allLinks) {
    try {
      await sleep(rateLimit);

      const isInternal = isSameDomain(url, domain);
      const timeout = isInternal ? DEFAULT_TIMEOUT : externalTimeout;

      const status = await checkLink(url, timeout);

      if (status.isWorking) {
        workingCount++;
        console.log(`  ✓ ${status.status} ${url}`);
      } else {
        brokenLinks.push(status);
        console.log(`  ✗ ${status.status} ${url}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      brokenLinks.push({
        url,
        status: 0,
        statusText: 'Error',
        isWorking: false,
        redirectChainLength: 0,
        responseTime: 0,
        error: errorMsg,
      });
      console.error(`  ✗ Error: ${url} - ${errorMsg}`);
    }
  }

  // Categorize broken links
  const summary = {
    total404: brokenLinks.filter(l => l.status === 404).length,
    totalTimeouts: brokenLinks.filter(l => l.error?.includes('timeout')).length,
    totalRedirectChains: brokenLinks.filter(l => l.redirectChainLength > 2).length,
  };

  const result: BrokenLinkResult = {
    domain,
    timestamp: new Date().toISOString(),
    brokenLinks,
    workingLinks: workingCount,
    totalChecked: allLinks.size,
    orphanedPages: findOrphanedPages(domain, mission),
    summary,
  };

  writeJsonFile(
    path.join(mission.linksDir, 'broken-links.json'),
    result,
  );

  console.log(`\n✓ Link check complete (${calculateElapsedTime(startTime)}s)`);
  console.log(`  Working: ${workingCount}/${allLinks.size}`);
  console.log(`  Broken: ${brokenLinks.length}`);
  console.log(`  404 errors: ${summary.total404}`);
  console.log(`  Timeouts: ${summary.totalTimeouts}`);
  console.log(`  Redirect chains: ${summary.totalRedirectChains}`);

  return result;
}

async function checkLink(url: string, timeout: number): Promise<LinkStatus> {
  const startTime = Date.now();

  try {
    const response = await axios.head(url, {
      timeout,
      maxRedirects: 5,
      validateStatus: () => true, // Don't throw on any status
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const responseTime = Date.now() - startTime;
    const isWorking = response.status >= 200 && response.status < 400;
    let redirectChainLength = 0;

    // Count redirects
    if (response.request) {
      const requestUrl = response.request.url;
      if (requestUrl !== url) {
        redirectChainLength = 1;
      }
    }

    return {
      url,
      status: response.status,
      statusText: response.statusText || '',
      isWorking,
      redirectUrl: response.data?.location || response.headers.location,
      redirectChainLength,
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const axiosError = error as AxiosError;

    if (axiosError.code === 'ECONNABORTED' || error instanceof Error && error.message.includes('timeout')) {
      return {
        url,
        status: 0,
        statusText: 'Timeout',
        isWorking: false,
        redirectChainLength: 0,
        responseTime,
        error: 'Request timeout',
      };
    }

    const errorMsg = error instanceof Error ? error.message : String(error);

    return {
      url,
      status: 0,
      statusText: 'Error',
      isWorking: false,
      redirectChainLength: 0,
      responseTime,
      error: errorMsg,
    };
  }
}

function findOrphanedPages(domain: string, mission: { crawlDataPath: string }): string[] {
  try {
    const crawlResult = readJsonFile<{ pages: PageMetadata[] }>(mission.crawlDataPath);
    if (!crawlResult || !crawlResult.pages) {
      return [];
    }

    const allUrls = new Set(crawlResult.pages.map(p => p.url));
    const referencedUrls = new Set<string>();

    // Collect all referenced URLs
    for (const page of crawlResult.pages) {
      for (const link of page.links.internal) {
        referencedUrls.add(link);
      }
    }

    // Find orphaned pages (in crawl but not referenced)
    const orphaned: string[] = [];
    const baseUrl = `https://${domain}`;

    for (const url of allUrls) {
      if (url !== baseUrl && !referencedUrls.has(url)) {
        orphaned.push(url);
      }
    }

    return orphaned;
  } catch {
    return [];
  }
}
