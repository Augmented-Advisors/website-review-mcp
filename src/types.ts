/**
 * Shared types for website review tools
 */

export interface PageMetadata {
  url: string;
  title: string;
  description?: string;
  h1?: string;
  canonical?: string;
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  wordCount?: number;
  links: {
    internal: string[];
    external: string[];
  };
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  isIndexed: boolean;
  noindex: boolean;
}

export interface CrawlResult {
  domain: string;
  startUrl: string;
  timestamp: string;
  pages: PageMetadata[];
  sitemapFound: boolean;
  totalPages: number;
  crawlDuration: number;
  errors: CrawlError[];
}

export interface CrawlError {
  url: string;
  error: string;
  timestamp: string;
}

export interface Screenshot {
  url: string;
  viewport: ViewportConfig;
  path: string;
  fileSize: number;
  timestamp: string;
}

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export interface ScreenshotResult {
  domain: string;
  timestamp: string;
  screenshots: Screenshot[];
  totalCaptured: number;
  totalFailed: number;
}

export interface LighthouseScore {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface CoreWebVital {
  metric: string;
  value: number;
  unit: string;
  rating: 'good' | 'needs-improvement' | 'poor';
}

export interface LighthouseAudit {
  url: string;
  viewport: 'desktop' | 'mobile';
  scores: LighthouseScore;
  coreWebVitals: CoreWebVital[];
  timestamp: string;
  auditsJson?: Record<string, unknown>;
}

export interface LighthouseResult {
  domain: string;
  timestamp: string;
  audits: LighthouseAudit[];
  summary: {
    avgScores: LighthouseScore;
    criticalIssues: string[];
  };
}

export interface LinkStatus {
  url: string;
  status: number;
  statusText: string;
  isWorking: boolean;
  redirectUrl?: string;
  redirectChainLength: number;
  responseTime: number;
  error?: string;
}

export interface BrokenLinkResult {
  domain: string;
  timestamp: string;
  brokenLinks: LinkStatus[];
  workingLinks: number;
  totalChecked: number;
  orphanedPages?: string[];
  summary: {
    total404: number;
    totalTimeouts: number;
    totalRedirectChains: number;
  };
}

export interface MissionControl {
  domain: string;
  baseDir: string;
  crawlDataPath: string;
  screenshotDir: string;
  lighthouseDir: string;
  linksDir: string;
  accessibilityDir: string;
  baselineDir: string;
  diffDir: string;
}

export interface AccessibilityViolationNode {
  html: string;
  target: string[];
  failureSummary: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
}

export interface AccessibilityViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AccessibilityViolationNode[];
}

export interface AccessibilityAudit {
  url: string;
  wcagLevel: 'A' | 'AA' | 'AAA';
  violations: AccessibilityViolation[];
  passes: number;
  incomplete: number;
  score: number;
  timestamp: string;
}

export interface AccessibilityResult {
  domain: string;
  timestamp: string;
  audits: AccessibilityAudit[];
  summary: {
    totalViolations: number;
    criticalViolations: number;
    seriousViolations: number;
    moderateViolations: number;
    minorViolations: number;
    avgScore: number;
  };
  errors?: string[];
}

export interface DiffMetrics {
  pixelsChanged: number;
  percentChanged: number;
  diffImagePath: string;
}

export interface ScreenshotComparison {
  pageSlug: string;
  viewport: string;
  baselinePath: string;
  currentPath: string;
  diffMetrics: DiffMetrics;
  verdict: 'pass' | 'fail' | 'review';
  threshold: number;
}

export interface BaselineComparisonResult {
  domain: string;
  timestamp: string;
  baselineHash: string;
  comparisons: ScreenshotComparison[];
  summary: {
    totalComparisons: number;
    passed: number;
    failed: number;
    needsReview: number;
    avgPercentChanged: number;
  };
  errors?: string[];
}

export interface PresentationSlideScreenshot {
  slideNumber: number;
  path: string;
  fileSize: number;
  timestamp: string;
}

export interface PresentationScreenshotResult {
  presentationPath: string;
  outputDir: string;
  timestamp: string;
  screenshots: PresentationSlideScreenshot[];
  totalSlides: number;
  totalCaptured: number;
  totalFailed: number;
  captureDuration: number;
}
