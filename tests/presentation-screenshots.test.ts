import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { capturePresentationScreenshots } from '../src/tools/presentation-screenshots.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(undefined),
          waitForFunction: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn()
            .mockResolvedValueOnce(3) // getTotalSlides
            .mockResolvedValueOnce(undefined) // next()
            .mockResolvedValueOnce(undefined), // next()
          screenshot: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('Presentation Screenshots', () => {
  const testOutputDir = '/tmp/test-presentation-screenshots';
  const testHtmlPath = '/tmp/test-presentation.html';

  beforeEach(() => {
    // Create test HTML file
    if (!fs.existsSync('/tmp')) {
      fs.mkdirSync('/tmp', { recursive: true });
    }
    fs.writeFileSync(testHtmlPath, '<html><body>Test</body></html>');

    // Create output directory
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }

    // Create mock screenshot files for file size checks
    for (let i = 0; i < 3; i++) {
      const filename = `slide-${String(i).padStart(2, '0')}.png`;
      const filepath = path.join(testOutputDir, filename);
      fs.writeFileSync(filepath, Buffer.alloc(1024)); // 1KB mock file
    }
  });

  afterEach(() => {
    // Cleanup test files
    if (fs.existsSync(testHtmlPath)) {
      fs.unlinkSync(testHtmlPath);
    }

    if (fs.existsSync(testOutputDir)) {
      const files = fs.readdirSync(testOutputDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(testOutputDir, file));
      });
      fs.rmdirSync(testOutputDir);
    }

    vi.clearAllMocks();
  });

  describe('capturePresentationScreenshots', () => {
    it('should capture screenshots of all slides', async () => {
      const result = await capturePresentationScreenshots({
        htmlPath: testHtmlPath,
        outputDir: testOutputDir,
      });

      expect(result).toBeDefined();
      expect(result.presentationPath).toBe(testHtmlPath);
      expect(result.outputDir).toBe(testOutputDir);
      expect(result.totalSlides).toBe(3);
      expect(result.totalCaptured).toBe(3);
      expect(result.totalFailed).toBe(0);
      expect(result.screenshots).toHaveLength(3);
    });

    it('should generate correctly named screenshot files', async () => {
      const result = await capturePresentationScreenshots({
        htmlPath: testHtmlPath,
        outputDir: testOutputDir,
      });

      const expectedFilenames = ['slide-00.png', 'slide-01.png', 'slide-02.png'];

      result.screenshots.forEach((screenshot, index) => {
        expect(path.basename(screenshot.path)).toBe(expectedFilenames[index]);
        expect(screenshot.slideNumber).toBe(index);
      });
    });

    it('should include file size information', async () => {
      const result = await capturePresentationScreenshots({
        htmlPath: testHtmlPath,
        outputDir: testOutputDir,
      });

      result.screenshots.forEach(screenshot => {
        expect(screenshot.fileSize).toBeGreaterThan(0);
        expect(screenshot.fileSize).toBe(1024); // Mock file size
      });
    });

    it('should include timestamps', async () => {
      const result = await capturePresentationScreenshots({
        htmlPath: testHtmlPath,
        outputDir: testOutputDir,
      });

      expect(result.timestamp).toBeDefined();
      result.screenshots.forEach(screenshot => {
        expect(screenshot.timestamp).toBeDefined();
        // Verify ISO 8601 format
        expect(() => new Date(screenshot.timestamp)).not.toThrow();
      });
    });

    it('should use default output directory if not specified', async () => {
      const result = await capturePresentationScreenshots({
        htmlPath: testHtmlPath,
      });

      expect(result.outputDir).toContain('.work/presentation-screenshots');
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        capturePresentationScreenshots({
          htmlPath: '/non/existent/file.html',
        }),
      ).rejects.toThrow('Presentation file not found');
    });

    it('should throw error for invalid file type', async () => {
      const txtPath = '/tmp/test.txt';
      fs.writeFileSync(txtPath, 'test');

      await expect(
        capturePresentationScreenshots({
          htmlPath: txtPath,
        }),
      ).rejects.toThrow('Invalid file type');

      fs.unlinkSync(txtPath);
    });

    it('should calculate capture duration', async () => {
      const result = await capturePresentationScreenshots({
        htmlPath: testHtmlPath,
        outputDir: testOutputDir,
      });

      expect(result.captureDuration).toBeGreaterThanOrEqual(0);
      expect(typeof result.captureDuration).toBe('number');
    });
  });
});
