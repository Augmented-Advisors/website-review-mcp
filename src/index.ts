#!/usr/bin/env node

import {
  Server,
} from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  crawlWebsite,
  captureScreenshots,
  runLighthouseAudit,
  checkBrokenLinks,
  runAccessibilityAudit,
  compareScreenshotsToBaseline,
  capturePresentationScreenshots,
} from './tools/index.js';

// Tool definitions with JSON schemas
const TOOLS: Tool[] = [
  {
    name: 'crawl_website',
    description: 'Crawl a website to discover pages and extract metadata. Uses sitemap-first approach with fallback to recursive link discovery.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The base URL to start crawling from (e.g., https://example.com)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum crawl depth (default: 3)',
          minimum: 1,
          maximum: 10,
        },
        maxPages: {
          type: 'number',
          description: 'Maximum pages to crawl (default: 100)',
          minimum: 1,
          maximum: 500,
        },
        respectRobotsTxt: {
          type: 'boolean',
          description: 'Whether to respect robots.txt directives (default: true)',
        },
        rateLimit: {
          type: 'number',
          description: 'Rate limit between requests in milliseconds (default: 1000)',
          minimum: 0,
          maximum: 10000,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'capture_screenshots',
    description: 'Capture full-page screenshots of discovered pages across multiple viewports (desktop, tablet, mobile).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Base URL for screenshot capture (optional if useCrawlData is true)',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs to capture (optional)',
        },
        viewports: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          description: 'Custom viewport configurations (default: desktop, tablet, mobile)',
        },
        useCrawlData: {
          type: 'boolean',
          description: 'Use discovered pages from crawl data (default: true)',
        },
        rateLimit: {
          type: 'number',
          description: 'Rate limit between screenshots in milliseconds (default: 2000)',
          minimum: 0,
          maximum: 10000,
        },
        saveAsBaseline: {
          type: 'boolean',
          description: 'Save screenshots as baseline for visual regression testing (default: false)',
        },
      },
    },
  },
  {
    name: 'run_lighthouse_audit',
    description: 'Run Google Lighthouse audits to measure performance, accessibility, SEO, and best practices.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to audit',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs to audit (optional)',
        },
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['performance', 'accessibility', 'best-practices', 'seo'],
          },
          description: 'Categories to audit (default: all)',
        },
        rateLimit: {
          type: 'number',
          description: 'Rate limit between audits in milliseconds (default: 5000)',
          minimum: 0,
          maximum: 30000,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'check_broken_links',
    description: 'Check all links on discovered pages for broken links, 404s, timeouts, and redirect chains.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Domain to check links for (uses crawl data)',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific URLs to check (optional)',
        },
        checkExternal: {
          type: 'boolean',
          description: 'Whether to check external links (default: false)',
        },
        externalTimeout: {
          type: 'number',
          description: 'Timeout for external link checks in milliseconds (default: 10000)',
          minimum: 1000,
          maximum: 30000,
        },
        rateLimit: {
          type: 'number',
          description: 'Rate limit between checks in milliseconds (default: 500)',
          minimum: 0,
          maximum: 5000,
        },
      },
    },
  },
  {
    name: 'run_accessibility_audit',
    description: 'Run comprehensive accessibility audits using axe-core to detect WCAG 2.1 and 2.2 violations. Detects 90%+ of accessibility issues compared to 57% with Lighthouse alone.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to audit',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs to audit (optional)',
        },
        wcagLevel: {
          type: 'string',
          enum: ['A', 'AA', 'AAA'],
          description: 'WCAG compliance level to test (default: AA)',
        },
        rateLimit: {
          type: 'number',
          description: 'Rate limit between audits in milliseconds (default: 2000)',
          minimum: 0,
          maximum: 10000,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'compare_screenshots_to_baseline',
    description: 'Compare current screenshots to a baseline using pixel-diff analysis with pixelmatch. Generates diff images highlighting changes and returns pass/fail/review verdicts based on threshold.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Domain to compare (e.g., "example.com")',
        },
        baselineHash: {
          type: 'string',
          description: 'Git commit hash of the baseline to compare against',
        },
        threshold: {
          type: 'number',
          description: 'Threshold for pass/fail as decimal (default: 0.01 = 1% change triggers fail)',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['domain', 'baselineHash'],
    },
  },
  {
    name: 'capture_presentation_screenshots',
    description: 'Capture screenshots of all slides in a reveal.js HTML presentation. Navigates through slides using Reveal.js API and captures 1920x1080 full-page screenshots.',
    inputSchema: {
      type: 'object',
      properties: {
        htmlPath: {
          type: 'string',
          description: 'Absolute path to the reveal.js HTML presentation file',
        },
        outputDir: {
          type: 'string',
          description: 'Output directory for screenshots (default: .work/presentation-screenshots/)',
        },
      },
      required: ['htmlPath'],
    },
  },
];

// Create MCP server
const server = new Server({
  name: 'website-review-tools',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

// Initialize
server.setRequestHandler(InitializeRequestSchema, async () => {
  console.error('[website-review-tools] Initializing server');
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'website-review-tools',
      version: '1.0.0',
    },
  };
});

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name as string;
  const args = request.params.arguments as Record<string, unknown> || {};

  console.error(`[website-review-tools] Calling tool: ${name}`);

  try {
    let result: unknown;

    switch (name) {
      case 'crawl_website': {
        const url = args.url as string;
        const maxDepth = (args.maxDepth as number) || undefined;
        const maxPages = (args.maxPages as number) || undefined;
        const respectRobotsTxt = (args.respectRobotsTxt as boolean) ?? true;
        const rateLimit = (args.rateLimit as number) || undefined;

        result = await crawlWebsite({
          url,
          maxDepth,
          maxPages,
          respectRobotsTxt,
          rateLimit,
        });
        break;
      }

      case 'capture_screenshots': {
        const url = args.url as string | undefined;
        const urls = (args.urls as string[]) || [];
        const useCrawlData = (args.useCrawlData as boolean) ?? true;
        const rateLimit = (args.rateLimit as number) || undefined;
        const saveAsBaseline = (args.saveAsBaseline as boolean) ?? false;

        result = await captureScreenshots({
          url,
          urls,
          useCrawlData,
          rateLimit,
          saveAsBaseline,
        });
        break;
      }

      case 'run_lighthouse_audit': {
        const url = args.url as string;
        const urls = (args.urls as string[]) || [];
        const rateLimit = (args.rateLimit as number) || undefined;

        result = await runLighthouseAudit({
          url,
          urls,
          rateLimit,
        });
        break;
      }

      case 'check_broken_links': {
        const domain = args.domain as string | undefined;
        const urls = (args.urls as string[]) || [];
        const checkExternal = (args.checkExternal as boolean) ?? false;
        const externalTimeout = (args.externalTimeout as number) || undefined;
        const rateLimit = (args.rateLimit as number) || undefined;

        result = await checkBrokenLinks({
          domain,
          urls,
          checkExternal,
          externalTimeout,
          rateLimit,
        });
        break;
      }

      case 'run_accessibility_audit': {
        const url = args.url as string;
        const urls = (args.urls as string[]) || [];
        const wcagLevel = (args.wcagLevel as 'A' | 'AA' | 'AAA') || 'AA';
        const rateLimit = (args.rateLimit as number) || undefined;

        result = await runAccessibilityAudit({
          url,
          urls,
          wcagLevel,
          rateLimit,
        });
        break;
      }

      case 'compare_screenshots_to_baseline': {
        const domain = args.domain as string;
        const baselineHash = args.baselineHash as string;
        const threshold = (args.threshold as number) || 0.01;

        result = await compareScreenshotsToBaseline({
          domain,
          baselineHash,
          threshold,
        });
        break;
      }

      case 'capture_presentation_screenshots': {
        const htmlPath = args.htmlPath as string;
        const outputDir = args.outputDir as string | undefined;

        result = await capturePresentationScreenshots({
          htmlPath,
          outputDir,
        });
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[website-review-tools] Error in ${name}: ${errorMsg}`);

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMsg}`,
          isError: true,
        },
      ],
    };
  }
});

// Start server
async function main() {
  console.error('[website-review-tools] Starting MCP server on stdio');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[website-review-tools] Server connected');
}

main().catch(error => {
  console.error('[website-review-tools] Fatal error:', error);
  process.exit(1);
});
