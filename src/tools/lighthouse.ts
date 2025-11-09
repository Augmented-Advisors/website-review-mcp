import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import {
  LighthouseAudit,
  LighthouseResult,
  LighthouseScore,
  CoreWebVital,
} from '../types.js';
import {
  extractDomain,
  createMissionControl,
  writeJsonFile,
  calculateElapsedTime,
  sleep,
} from '../utils.js';

const execAsync = promisify(exec);

interface LighthouseOptions {
  url: string;
  urls?: string[];
  rateLimit?: number;
}

const RATE_LIMIT_MS = 5000;

export async function runLighthouseAudit(options: LighthouseOptions): Promise<LighthouseResult> {
  const startTime = Date.now();
  const {
    url,
    urls = [],
    rateLimit = RATE_LIMIT_MS,
  } = options;

  if (!url && urls.length === 0) {
    throw new Error('Must provide url or urls for Lighthouse audit');
  }

  const urlsToAudit = urls.length > 0 ? urls : [url];
  const domain = extractDomain(urlsToAudit[0]);
  const mission = createMissionControl(domain);

  const audits: LighthouseAudit[] = [];

  for (const auditUrl of urlsToAudit) {
    try {
      // Run desktop audit
      console.log(`Auditing ${auditUrl} (desktop)...`);
      await sleep(rateLimit);
      const desktopResult = await runLighthouse(auditUrl, 'desktop', mission);
      if (desktopResult) {
        audits.push(desktopResult);
      }

      // Run mobile audit
      console.log(`Auditing ${auditUrl} (mobile)...`);
      await sleep(rateLimit);
      const mobileResult = await runLighthouse(auditUrl, 'mobile', mission);
      if (mobileResult) {
        audits.push(mobileResult);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to audit ${auditUrl}: ${errorMsg}`);
    }
  }

  // Calculate summary
  const avgScores = calculateAverageScores(audits);
  const criticalIssues = findCriticalIssues(audits);

  const result: LighthouseResult = {
    domain,
    timestamp: new Date().toISOString(),
    audits,
    summary: {
      avgScores,
      criticalIssues,
    },
  };

  writeJsonFile(
    path.join(mission.lighthouseDir, 'summary.json'),
    result,
  );

  console.log(`\n✓ Lighthouse audits complete (${calculateElapsedTime(startTime)}s)`);
  console.log(`  Performance: ${avgScores.performance}/100`);
  console.log(`  Accessibility: ${avgScores.accessibility}/100`);
  console.log(`  Best Practices: ${avgScores.bestPractices}/100`);
  console.log(`  SEO: ${avgScores.seo}/100`);

  return result;
}

async function runLighthouse(
  url: string,
  profile: 'desktop' | 'mobile',
  mission: { lighthouseDir: string; domain: string },
): Promise<LighthouseAudit | null> {
  try {
    const outputFile = path.join(
      mission.lighthouseDir,
      `lighthouse-${profile}-${Date.now()}.json`,
    );

    const command = [
      'npx lighthouse',
      url,
      '--output=json',
      `--output-path=${outputFile}`,
      '--chrome-flags="--headless --no-sandbox"',
      profile === 'mobile' ? '--emulated-form-factor=mobile' : '--emulated-form-factor=desktop',
    ].join(' ');

    console.log(`  Running: ${command.substring(0, 100)}...`);

    await execAsync(command, {
      timeout: 120000,
      shell: '/bin/bash',
    });

    if (!fs.existsSync(outputFile)) {
      console.error(`Lighthouse output file not found: ${outputFile}`);
      return null;
    }

    const reportContent = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));

    // Extract scores
    const scores = extractScores(reportContent);
    const coreWebVitals = extractCoreWebVitals(reportContent);

    const audit: LighthouseAudit = {
      url,
      viewport: profile,
      scores,
      coreWebVitals,
      timestamp: new Date().toISOString(),
      auditsJson: reportContent,
    };

    console.log(`    Performance: ${scores.performance}, Accessibility: ${scores.accessibility}`);

    return audit;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`  Error running Lighthouse: ${errorMsg}`);
    return null;
  }
}

function extractScores(report: Record<string, unknown>): LighthouseScore {
  try {
    const categories = report.categories as Record<string, Record<string, number>>;
    return {
      performance: Math.round((categories.performance?.score || 0) * 100),
      accessibility: Math.round((categories.accessibility?.score || 0) * 100),
      bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
      seo: Math.round((categories.seo?.score || 0) * 100),
    };
  } catch {
    return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
  }
}

function extractCoreWebVitals(report: Record<string, unknown>): CoreWebVital[] {
  const vitals: CoreWebVital[] = [];

  try {
    const audits = report.audits as Record<string, Record<string, unknown>>;

    const vitalMappings: Record<string, string> = {
      'largest-contentful-paint': 'LCP',
      'first-input-delay': 'FID',
      'cumulative-layout-shift': 'CLS',
    };

    for (const [auditKey, label] of Object.entries(vitalMappings)) {
      const audit = audits?.[auditKey] as Record<string, unknown>;
      if (audit && audit.numericValue !== undefined) {
        const value = audit.numericValue as number;
        const rating = getVitalRating(label, value);

        vitals.push({
          metric: label,
          value,
          unit: getVitalUnit(label),
          rating,
        });
      }
    }
  } catch {
    // Continue with empty vitals
  }

  return vitals;
}

function getVitalRating(metric: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const thresholds: Record<string, { good: number; needsImprovement: number }> = {
    LCP: { good: 2500, needsImprovement: 4000 },
    FID: { good: 100, needsImprovement: 300 },
    CLS: { good: 0.1, needsImprovement: 0.25 },
  };

  const threshold = thresholds[metric];
  if (!threshold) return 'needs-improvement';

  if (value <= threshold.good) return 'good';
  if (value <= threshold.needsImprovement) return 'needs-improvement';
  return 'poor';
}

function getVitalUnit(metric: string): string {
  switch (metric) {
    case 'LCP':
    case 'FID':
      return 'ms';
    case 'CLS':
      return 'score';
    default:
      return '';
  }
}

function calculateAverageScores(audits: LighthouseAudit[]): LighthouseScore {
  if (audits.length === 0) {
    return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
  }

  const totals = {
    performance: 0,
    accessibility: 0,
    bestPractices: 0,
    seo: 0,
  };

  for (const audit of audits) {
    totals.performance += audit.scores.performance;
    totals.accessibility += audit.scores.accessibility;
    totals.bestPractices += audit.scores.bestPractices;
    totals.seo += audit.scores.seo;
  }

  return {
    performance: Math.round(totals.performance / audits.length),
    accessibility: Math.round(totals.accessibility / audits.length),
    bestPractices: Math.round(totals.bestPractices / audits.length),
    seo: Math.round(totals.seo / audits.length),
  };
}

function findCriticalIssues(audits: LighthouseAudit[]): string[] {
  const issues: string[] = [];

  for (const audit of audits) {
    const scores = audit.scores;
    if (scores.performance < 50) {
      issues.push(`Performance score too low on ${audit.url} (${audit.viewport}): ${scores.performance}/100`);
    }
    if (scores.accessibility < 50) {
      issues.push(`Accessibility issues on ${audit.url} (${audit.viewport}): ${scores.accessibility}/100`);
    }
    if (scores.seo < 50) {
      issues.push(`SEO issues on ${audit.url} (${audit.viewport}): ${scores.seo}/100`);
    }
  }

  return issues;
}
