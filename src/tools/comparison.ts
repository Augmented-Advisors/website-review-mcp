import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import {
  BaselineComparisonResult,
  ScreenshotComparison,
  DiffMetrics,
} from '../types.js';
import {
  createMissionControl,
  writeJsonFile,
  readJsonFile,
  calculateElapsedTime,
  ensureDir,
} from '../utils.js';

interface ComparisonOptions {
  domain: string;
  baselineHash: string;
  threshold?: number; // Default 0.01 (1% change triggers fail)
}

export async function compareScreenshotsToBaseline(
  options: ComparisonOptions,
): Promise<BaselineComparisonResult> {
  const startTime = Date.now();
  const { domain, baselineHash, threshold = 0.01 } = options;

  const mission = createMissionControl(domain);
  const baselineDir = path.join(mission.baselineDir, baselineHash);

  // Validate baseline exists
  if (!fs.existsSync(baselineDir)) {
    throw new Error(
      `Baseline not found for hash ${baselineHash}. Available baselines: ${getAvailableBaselines(mission.baselineDir).join(', ')}`,
    );
  }

  // Read baseline metadata
  const baselineMetadata = readJsonFile<{
    screenshots: Array<{ filename: string; url: string; viewport: any }>;
  }>(path.join(baselineDir, 'metadata.json'));

  if (!baselineMetadata || !baselineMetadata.screenshots) {
    throw new Error(`Invalid baseline metadata for hash ${baselineHash}`);
  }

  const comparisons: ScreenshotComparison[] = [];
  const errors: string[] = [];

  // Create diff directory with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const diffDir = path.join(mission.diffDir, timestamp);
  ensureDir(diffDir);

  console.log(`\nComparing ${baselineMetadata.screenshots.length} screenshots against baseline ${baselineHash}...\n`);

  // Compare each screenshot
  for (const baselineScreenshot of baselineMetadata.screenshots) {
    try {
      const { filename, viewport } = baselineScreenshot;
      const baselinePath = path.join(baselineDir, filename);
      const currentPath = path.join(mission.screenshotDir, filename);

      // Check if current screenshot exists
      if (!fs.existsSync(currentPath)) {
        const errorMsg = `Current screenshot not found: ${filename}`;
        console.error(`  ✗ ${errorMsg}`);
        errors.push(errorMsg);
        continue;
      }

      console.log(`  Comparing ${filename}...`);

      // Load images
      const baselineImg = PNG.sync.read(fs.readFileSync(baselinePath));
      const currentImg = PNG.sync.read(fs.readFileSync(currentPath));

      // Ensure dimensions match
      if (
        baselineImg.width !== currentImg.width ||
        baselineImg.height !== currentImg.height
      ) {
        const errorMsg = `Dimension mismatch for ${filename}: baseline ${baselineImg.width}x${baselineImg.height} vs current ${currentImg.width}x${currentImg.height}`;
        console.error(`    ✗ ${errorMsg}`);
        errors.push(errorMsg);
        continue;
      }

      // Create diff image
      const diffImg = new PNG({
        width: baselineImg.width,
        height: baselineImg.height,
      });

      // Run pixelmatch comparison
      const pixelsChanged = pixelmatch(
        baselineImg.data,
        currentImg.data,
        diffImg.data,
        baselineImg.width,
        baselineImg.height,
        {
          threshold: 0.1, // Pixel-level sensitivity (0.1 is default)
          includeAA: false, // Ignore anti-aliasing differences
        },
      );

      // Calculate percentage changed
      const totalPixels = baselineImg.width * baselineImg.height;
      const percentChanged = (pixelsChanged / totalPixels) * 100;

      // Save diff image
      const diffFilename = `${path.basename(filename, '.png')}-diff.png`;
      const diffImagePath = path.join(diffDir, diffFilename);
      fs.writeFileSync(diffImagePath, PNG.sync.write(diffImg));

      // Determine verdict based on threshold
      let verdict: 'pass' | 'fail' | 'review';
      if (percentChanged < threshold * 100) {
        verdict = 'pass';
      } else if (percentChanged < threshold * 200) {
        // 1-2% = review
        verdict = 'review';
      } else {
        verdict = 'fail';
      }

      const diffMetrics: DiffMetrics = {
        pixelsChanged,
        percentChanged: parseFloat(percentChanged.toFixed(4)),
        diffImagePath,
      };

      // Extract page slug and viewport name
      const pageSlug = filename.replace(/-desktop\.png|-tablet\.png|-mobile\.png/, '');
      const viewportName = viewport.name || extractViewportFromFilename(filename);

      comparisons.push({
        pageSlug,
        viewport: viewportName,
        baselinePath,
        currentPath,
        diffMetrics,
        verdict,
        threshold: threshold * 100, // Convert to percentage for display
      });

      console.log(`    ${verdict === 'pass' ? '✓' : verdict === 'fail' ? '✗' : '⚠'} ${percentChanged.toFixed(4)}% changed (${verdict})`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const fullError = `Failed to compare ${baselineScreenshot.filename}: ${errorMsg}`;
      console.error(`  ✗ ${fullError}`);
      errors.push(fullError);
    }
  }

  // Calculate summary statistics
  const passed = comparisons.filter(c => c.verdict === 'pass').length;
  const failed = comparisons.filter(c => c.verdict === 'fail').length;
  const needsReview = comparisons.filter(c => c.verdict === 'review').length;
  const avgPercentChanged =
    comparisons.length > 0
      ? comparisons.reduce((sum, c) => sum + c.diffMetrics.percentChanged, 0) /
        comparisons.length
      : 0;

  const result: BaselineComparisonResult = {
    domain,
    timestamp,
    baselineHash,
    comparisons,
    summary: {
      totalComparisons: comparisons.length,
      passed,
      failed,
      needsReview,
      avgPercentChanged: parseFloat(avgPercentChanged.toFixed(4)),
    },
    ...(errors.length > 0 && { errors }),
  };

  // Save comparison report
  writeJsonFile(path.join(diffDir, 'comparison-report.json'), result);

  console.log(`\n✓ Comparison complete in ${calculateElapsedTime(startTime)}s`);
  console.log(`  Passed: ${passed} | Failed: ${failed} | Review: ${needsReview}`);
  console.log(`  Avg change: ${avgPercentChanged.toFixed(4)}%`);
  console.log(`  Diff images saved to: ${diffDir}/`);

  return result;
}

function getAvailableBaselines(baselineDir: string): string[] {
  if (!fs.existsSync(baselineDir)) {
    return [];
  }
  return fs
    .readdirSync(baselineDir)
    .filter(item => fs.statSync(path.join(baselineDir, item)).isDirectory());
}

function extractViewportFromFilename(filename: string): string {
  if (filename.includes('-desktop.png')) {
    return 'desktop';
  } else if (filename.includes('-tablet.png')) {
    return 'tablet';
  } else if (filename.includes('-mobile.png')) {
    return 'mobile';
  }
  return 'unknown';
}
