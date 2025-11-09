import { chromium, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  PresentationScreenshotResult,
  PresentationSlideScreenshot,
} from '../types.js';
import {
  ensureDir,
  formatBytes,
  calculateElapsedTime,
} from '../utils.js';

const DEFAULT_OUTPUT_DIR = '/Users/craig/Code/core/.work/presentation-screenshots';
const DEFAULT_TIMEOUT = 10000;
const SLIDE_TRANSITION_DELAY = 500; // Wait for slide transitions

interface PresentationScreenshotOptions {
  htmlPath: string;
  outputDir?: string;
}

/**
 * Capture screenshots of all slides in a reveal.js presentation
 */
export async function capturePresentationScreenshots(
  options: PresentationScreenshotOptions,
): Promise<PresentationScreenshotResult> {
  const startTime = Date.now();
  const { htmlPath, outputDir = DEFAULT_OUTPUT_DIR } = options;

  // Validate input
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Presentation file not found: ${htmlPath}`);
  }

  if (!htmlPath.endsWith('.html')) {
    throw new Error(`Invalid file type. Expected .html file, got: ${htmlPath}`);
  }

  // Ensure output directory exists
  ensureDir(outputDir);

  const screenshots: PresentationSlideScreenshot[] = [];
  let browser: Browser | null = null;
  let totalSlides = 0;

  try {
    console.log(`Opening presentation: ${htmlPath}`);
    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    // Load the presentation
    const fileUrl = `file://${path.resolve(htmlPath)}`;
    await page.goto(fileUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    });

    // Wait for reveal.js to be ready
    try {
      await page.waitForFunction(
        `typeof window.Reveal !== 'undefined' && window.Reveal.isReady()`,
        { timeout: 5000 },
      );
      console.log('✓ Reveal.js detected and ready');
    } catch (error) {
      throw new Error('Reveal.js not detected. Is this a valid reveal.js presentation?');
    }

    // Get total number of slides
    totalSlides = await page.evaluate(
      `window.Reveal.getTotalSlides()`,
    ) as number;

    console.log(`\nCapturing ${totalSlides} slides...`);

    // Capture each slide
    for (let i = 0; i < totalSlides; i++) {
      try {
        // Wait for slide transition to complete
        await page.waitForTimeout(SLIDE_TRANSITION_DELAY);

        // Generate filename with zero-padded slide number
        const slideNumberPadded = String(i).padStart(2, '0');
        const filename = `slide-${slideNumberPadded}.png`;
        const filepath = path.join(outputDir, filename);

        // Capture screenshot
        await page.screenshot({
          path: filepath,
          fullPage: true,
        });

        const stats = fs.statSync(filepath);

        screenshots.push({
          slideNumber: i,
          path: filepath,
          fileSize: stats.size,
          timestamp: new Date().toISOString(),
        });

        console.log(`  ✓ Slide ${i + 1}/${totalSlides}: ${filename} (${formatBytes(stats.size)})`);

        // Navigate to next slide (if not the last slide)
        if (i < totalSlides - 1) {
          await page.evaluate(`window.Reveal.next()`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ Failed to capture slide ${i}: ${errorMsg}`);
      }
    }

    await page.close();
    await context.close();

    const captureDuration = calculateElapsedTime(startTime);

    const result: PresentationScreenshotResult = {
      presentationPath: htmlPath,
      outputDir,
      timestamp: new Date().toISOString(),
      screenshots,
      totalSlides,
      totalCaptured: screenshots.length,
      totalFailed: totalSlides - screenshots.length,
      captureDuration,
    };

    console.log(`\n✓ Captured ${screenshots.length}/${totalSlides} slides in ${captureDuration}s`);
    console.log(`  Output directory: ${outputDir}`);

    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
