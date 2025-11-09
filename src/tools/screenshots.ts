import { chromium, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  Screenshot,
  ScreenshotResult,
  ViewportConfig,
  PageMetadata,
} from '../types.js';
import {
  extractDomain,
  createMissionControl,
  writeJsonFile,
  calculateElapsedTime,
  formatBytes,
  readJsonFile,
  getPageSlug,
  sleep,
  isValidUrl,
  getCurrentGitHash,
  ensureDir,
} from '../utils.js';

const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const DEFAULT_TIMEOUT = 30000;
const RATE_LIMIT_MS = 2000;

interface ScreenshotOptions {
  url?: string;
  urls?: string[];
  viewports?: ViewportConfig[];
  rateLimit?: number;
  useCrawlData?: boolean;
  saveAsBaseline?: boolean;
}

export async function captureScreenshots(options: ScreenshotOptions): Promise<ScreenshotResult> {
  const startTime = Date.now();
  const {
    url,
    urls = [],
    viewports = DEFAULT_VIEWPORTS,
    rateLimit = RATE_LIMIT_MS,
    useCrawlData = true,
    saveAsBaseline = false,
  } = options;

  // Determine URLs to capture
  let urlsToCapture: string[] = [];

  if (useCrawlData && (url || urls.length > 0)) {
    const domain = extractDomain(url || urls[0] || '');
    const mission = createMissionControl(domain);
    const crawlResult = readJsonFile<{ pages: PageMetadata[] }>(mission.crawlDataPath);

    if (crawlResult && crawlResult.pages) {
      urlsToCapture = crawlResult.pages.map(p => p.url);
    }
  }

  if (urls.length > 0) {
    urlsToCapture = urls;
  } else if (url) {
    urlsToCapture = [url];
  }

  if (urlsToCapture.length === 0) {
    throw new Error('No URLs provided for screenshot capture');
  }

  const domain = extractDomain(urlsToCapture[0]);
  const mission = createMissionControl(domain);

  const screenshots: Screenshot[] = [];
  let browser: Browser | null = null;

  try {
    // Install Playwright browsers if needed
    console.log('Starting Playwright browser...');
    browser = await chromium.launch({ headless: true });

    for (const viewport of viewports) {
      console.log(`\nCapturing ${viewport.name} viewport (${viewport.width}x${viewport.height})...`);
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });

      try {
        const page = await context.newPage();

        for (const pageUrl of urlsToCapture) {
          try {
            await sleep(rateLimit);

            console.log(`  → ${getPageSlug(pageUrl)}`);

            // Navigate to page
            await page.goto(pageUrl, {
              waitUntil: 'domcontentloaded',
              timeout: DEFAULT_TIMEOUT,
            });

            // Wait for network idle (with timeout fallback)
            try {
              await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
                console.log('    (network idle timeout, continuing)');
              });
            } catch {
              // Continue anyway
            }

            // Wait for animations
            await page.waitForTimeout(500);

            // Capture full page screenshot
            const slug = getPageSlug(pageUrl);
            const filename = `${slug}-${viewport.name}.png`;
            const filepath = path.join(mission.screenshotDir, filename);

            await page.screenshot({
              path: filepath,
              fullPage: true,
            });

            const stats = fs.statSync(filepath);

            screenshots.push({
              url: pageUrl,
              viewport,
              path: filepath,
              fileSize: stats.size,
              timestamp: new Date().toISOString(),
            });

            console.log(`    ✓ ${formatBytes(stats.size)}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`    ✗ Failed: ${errorMsg}`);
          }
        }

        await page.close();
      } finally {
        await context.close();
      }
    }

    // Save results
    const result: ScreenshotResult = {
      domain,
      timestamp: new Date().toISOString(),
      screenshots,
      totalCaptured: screenshots.length,
      totalFailed: urlsToCapture.length * viewports.length - screenshots.length,
    };

    writeJsonFile(
      path.join(mission.screenshotDir, 'index.json'),
      result,
    );

    // If saveAsBaseline is true, copy screenshots to baseline directory
    if (saveAsBaseline) {
      const gitHash = getCurrentGitHash();
      const baselineHashDir = path.join(mission.baselineDir, gitHash);
      ensureDir(baselineHashDir);

      console.log(`\nSaving baseline screenshots to ${gitHash}/`);

      for (const screenshot of screenshots) {
        const filename = path.basename(screenshot.path);
        const baselinePath = path.join(baselineHashDir, filename);
        fs.copyFileSync(screenshot.path, baselinePath);
        console.log(`  ✓ ${filename}`);
      }

      // Save baseline metadata
      writeJsonFile(
        path.join(baselineHashDir, 'metadata.json'),
        {
          gitHash,
          timestamp: result.timestamp,
          domain,
          screenshotCount: screenshots.length,
          screenshots: screenshots.map(s => ({
            filename: path.basename(s.path),
            url: s.url,
            viewport: s.viewport,
          })),
        },
      );

      console.log(`✓ Baseline saved with hash ${gitHash}`);
    }

    console.log(`\n✓ Captured ${screenshots.length} screenshots in ${calculateElapsedTime(startTime)}s`);

    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function captureScreenshot(
  pageUrl: string,
  viewportConfig: ViewportConfig,
  outputDir: string,
): Promise<string> {
  if (!isValidUrl(pageUrl)) {
    throw new Error(`Invalid URL: ${pageUrl}`);
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: viewportConfig.width, height: viewportConfig.height },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    } catch {
      // Continue
    }

    await page.waitForTimeout(500);

    const slug = getPageSlug(pageUrl);
    const filename = `${slug}-${viewportConfig.name}.png`;
    const filepath = path.join(outputDir, filename);

    await page.screenshot({
      path: filepath,
      fullPage: true,
    });

    await page.close();
    await context.close();

    return filepath;
  } finally {
    await browser.close();
  }
}
