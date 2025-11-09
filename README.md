# Website Review MCP Server

Model Context Protocol (MCP) server providing comprehensive website audit capabilities.

## Features

- 🕷️ **Website Crawling** - Sitemap-based discovery with recursive fallback
- 📸 **Screenshots** - Multi-viewport capture (desktop, tablet, mobile)
- ⚡ **Lighthouse Audits** - Performance, accessibility, SEO, best practices
- ♿ **Accessibility** - axe-core WCAG 2.1/2.2 compliance checks
- 🔗 **Broken Links** - Link validation and redirect chain detection
- 📊 **Visual Regression** - Screenshot comparison with pixel-diff analysis

## Installation

```bash
npm install @augmented-advisors/website-review-mcp
```

## MCP Configuration

Add to your MCP settings (`.mcp.json`):

```json
{
  "mcpServers": {
    "website-review": {
      "type": "stdio",
      "command": "npx",
      "args": ["@augmented-advisors/website-review-mcp"],
      "env": {
        "REVIEW_WORK_DIR": "${workspaceFolder}/.work/website-reviews"
      }
    }
  }
}
```

## Available Tools

- `mcp__website-review__crawl_website` - Discover pages via sitemap
- `mcp__website-review__capture_screenshots` - Multi-viewport screenshots
- `mcp__website-review__run_lighthouse_audit` - Performance audits
- `mcp__website-review__check_broken_links` - Link validation
- `mcp__website-review__run_accessibility_audit` - WCAG compliance
- `mcp__website-review__compare_screenshots_to_baseline` - Visual regression

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Run locally
npm run dev
```

## License

MIT License - see LICENSE file for details

## Author

Craig Trulove (Augmented Advisors LLC)
