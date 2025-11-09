import { chromium, Browser, Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import * as path from 'path';
import {
  AccessibilityAudit,
  AccessibilityResult,
  AccessibilityViolation,
} from '../types.js';
import {
  extractDomain,
  createMissionControl,
  writeJsonFile,
  calculateElapsedTime,
  sleep,
} from '../utils.js';

interface AccessibilityOptions {
  url: string;
  urls?: string[];
  wcagLevel?: 'A' | 'AA' | 'AAA';
  rateLimit?: number;
}

const RATE_LIMIT_MS = 2000;

export async function runAccessibilityAudit(
  options: AccessibilityOptions,
): Promise<AccessibilityResult> {
  const startTime = Date.now();
  const {
    url,
    urls = [],
    wcagLevel = 'AA',
    rateLimit = RATE_LIMIT_MS,
  } = options;

  if (!url && urls.length === 0) {
    throw new Error('Must provide url or urls for accessibility audit');
  }

  const urlsToAudit = urls.length > 0 ? urls : [url];
  const domain = extractDomain(urlsToAudit[0]);
  const mission = createMissionControl(domain);

  let browser: Browser | null = null;
  const audits: AccessibilityAudit[] = [];
  const errors: string[] = [];

  try {
    browser = await chromium.launch({ headless: true });

    for (const auditUrl of urlsToAudit) {
      try {
        console.log(`Auditing accessibility for ${auditUrl}...`);
        await sleep(rateLimit);

        const auditResult = await runAxeAudit(
          browser,
          auditUrl,
          wcagLevel,
          mission,
        );

        audits.push(auditResult);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const fullError = `Failed to audit ${auditUrl}: ${errorMsg}`;
        console.error(fullError);
        errors.push(fullError);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const fullError = `Failed to launch browser: ${errorMsg}`;
    console.error(fullError);
    errors.push(fullError);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Calculate summary statistics
  const summary = calculateSummary(audits);

  const result: AccessibilityResult = {
    domain,
    timestamp: new Date().toISOString(),
    audits,
    summary,
    ...(errors.length > 0 && { errors }),
  };

  // Save summary to JSON
  writeJsonFile(
    path.join(mission.accessibilityDir, 'axe-results.json'),
    result,
  );

  console.log(`\n✓ Accessibility audits complete (${calculateElapsedTime(startTime)}s)`);
  console.log(`  Total Violations: ${summary.totalViolations}`);
  console.log(`  Critical: ${summary.criticalViolations}`);
  console.log(`  Serious: ${summary.seriousViolations}`);
  console.log(`  Moderate: ${summary.moderateViolations}`);
  console.log(`  Minor: ${summary.minorViolations}`);
  console.log(`  Average Score: ${summary.avgScore}/100`);

  return result;
}

async function runAxeAudit(
  browser: Browser,
  url: string,
  wcagLevel: 'A' | 'AA' | 'AAA',
  mission: { accessibilityDir: string; domain: string },
): Promise<AccessibilityAudit> {
  let page: Page | null = null;
  let context = null;

  try {
    // Create browser context (required by axe-core Playwright integration)
    context = await browser.newContext();
    page = await context.newPage();

    console.log(`  Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Configure axe-core with WCAG tags
    const wcagTags = getWcagTags(wcagLevel);

    console.log(`  Running axe-core with ${wcagTags.join(', ')}...`);
    const axeResults = await new AxeBuilder({ page })
      .withTags(wcagTags)
      .analyze();

    // Transform axe violations to our format
    const violations: AccessibilityViolation[] = axeResults.violations.map(violation => {
      const nodes = violation.nodes.map(node => {
        // Convert target to string array
        let targetArray: string[];
        if (Array.isArray(node.target)) {
          targetArray = node.target.map(t => String(t));
        } else {
          targetArray = [String(node.target)];
        }

        return {
          html: node.html,
          target: targetArray,
          failureSummary: node.failureSummary || '',
          impact: node.impact as 'minor' | 'moderate' | 'serious' | 'critical' | undefined,
        };
      });

      return {
        id: violation.id,
        impact: violation.impact as 'minor' | 'moderate' | 'serious' | 'critical',
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        tags: violation.tags,
        nodes,
      };
    });

    // Calculate accessibility score (0-100)
    const score = calculateAccessibilityScore(violations);

    const audit: AccessibilityAudit = {
      url,
      wcagLevel,
      violations,
      passes: axeResults.passes.length,
      incomplete: axeResults.incomplete.length,
      score,
      timestamp: new Date().toISOString(),
    };

    // Save individual audit result
    const filename = `audit-${Date.now()}.json`;
    writeJsonFile(
      path.join(mission.accessibilityDir, filename),
      audit,
    );

    console.log(`    Score: ${score}/100, Violations: ${violations.length}, Passes: ${audit.passes}`);

    return audit;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`  Error running axe audit: ${errorMsg}`);
    throw new Error(`Axe audit failed: ${errorMsg}`);
  } finally {
    if (page) {
      await page.close();
    }
    if (context) {
      await context.close();
    }
  }
}

function getWcagTags(wcagLevel: 'A' | 'AA' | 'AAA'): string[] {
  const tags: string[] = ['wcag2a', 'wcag21a', 'wcag22a'];

  if (wcagLevel === 'AA' || wcagLevel === 'AAA') {
    tags.push('wcag2aa', 'wcag21aa', 'wcag22aa');
  }

  if (wcagLevel === 'AAA') {
    tags.push('wcag2aaa', 'wcag21aaa', 'wcag22aaa');
  }

  return tags;
}

function calculateAccessibilityScore(violations: AccessibilityViolation[]): number {
  if (violations.length === 0) {
    return 100;
  }

  // Weight violations by impact
  const impactWeights = {
    critical: 10,
    serious: 7,
    moderate: 4,
    minor: 1,
  };

  let totalWeight = 0;
  for (const violation of violations) {
    const weight = impactWeights[violation.impact] || 1;
    totalWeight += weight * violation.nodes.length;
  }

  // Score calculation: reduce from 100 based on weighted violations
  // More violations = lower score, capped at 0
  const deduction = Math.min(100, totalWeight * 2);
  return Math.max(0, 100 - deduction);
}

function calculateSummary(audits: AccessibilityAudit[]): {
  totalViolations: number;
  criticalViolations: number;
  seriousViolations: number;
  moderateViolations: number;
  minorViolations: number;
  avgScore: number;
} {
  if (audits.length === 0) {
    return {
      totalViolations: 0,
      criticalViolations: 0,
      seriousViolations: 0,
      moderateViolations: 0,
      minorViolations: 0,
      avgScore: 0,
    };
  }

  let totalViolations = 0;
  let criticalViolations = 0;
  let seriousViolations = 0;
  let moderateViolations = 0;
  let minorViolations = 0;
  let totalScore = 0;

  for (const audit of audits) {
    totalScore += audit.score;

    for (const violation of audit.violations) {
      const nodeCount = violation.nodes.length;
      totalViolations += nodeCount;

      switch (violation.impact) {
        case 'critical':
          criticalViolations += nodeCount;
          break;
        case 'serious':
          seriousViolations += nodeCount;
          break;
        case 'moderate':
          moderateViolations += nodeCount;
          break;
        case 'minor':
          minorViolations += nodeCount;
          break;
      }
    }
  }

  return {
    totalViolations,
    criticalViolations,
    seriousViolations,
    moderateViolations,
    minorViolations,
    avgScore: Math.round(totalScore / audits.length),
  };
}
