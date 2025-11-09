import { describe, it, expect } from 'vitest';
import {
  extractDomain,
  normalizeUrl,
  isSameDomain,
  getPageSlug,
  formatBytes,
  isValidUrl,
  parseRobotsText,
} from '../src/utils.js';

describe('Utils', () => {
  describe('extractDomain', () => {
    it('should extract domain from URL', () => {
      expect(extractDomain('https://example.com/page')).toBe('example.com');
      expect(extractDomain('https://www.example.com')).toBe('example.com');
      expect(extractDomain('http://subdomain.example.com')).toBe('subdomain.example.com');
    });

    it('should handle invalid URLs', () => {
      expect(extractDomain('not-a-url')).toBe('unknown-domain');
    });
  });

  describe('normalizeUrl', () => {
    it('should normalize absolute path URLs', () => {
      const base = 'https://example.com/page/';
      expect(normalizeUrl('/about', base)).toBe('https://example.com/about');
      expect(normalizeUrl('/contact', base)).toBe('https://example.com/contact');
    });

    it('should normalize relative path URLs per WHATWG URL spec', () => {
      // Relative paths resolve relative to current directory
      expect(normalizeUrl('contact', 'https://example.com/page/')).toBe('https://example.com/page/contact');
      expect(normalizeUrl('../about', 'https://example.com/page/subpage/')).toBe('https://example.com/page/about');
      expect(normalizeUrl('index.html', 'https://example.com/')).toBe('https://example.com/index.html');
    });

    it('should pass through absolute URLs', () => {
      const url = 'https://other.com/page';
      expect(normalizeUrl(url)).toBe(url);
    });
  });

  describe('isSameDomain', () => {
    it('should identify same domain', () => {
      expect(isSameDomain('https://example.com/a', 'https://example.com/b')).toBe(true);
      expect(isSameDomain('https://example.com', 'https://www.example.com')).toBe(false);
    });

    it('should handle invalid URLs', () => {
      expect(isSameDomain('not-a-url', 'https://example.com')).toBe(false);
    });
  });

  describe('getPageSlug', () => {
    it('should generate slugs from URLs', () => {
      expect(getPageSlug('https://example.com/')).toBe('home');
      expect(getPageSlug('https://example.com/about')).toBe('about');
      expect(getPageSlug('https://example.com/services/consulting')).toBe('services-consulting');
      expect(getPageSlug('https://example.com/page?id=1')).toBe('page');
    });
  });

  describe('formatBytes', () => {
    it('should format byte sizes', () => {
      expect(formatBytes(512)).toBe('512B');
      expect(formatBytes(1024)).toBe('1.00KB');
      expect(formatBytes(1024 * 1024)).toBe('1.00MB');
    });
  });

  describe('isValidUrl', () => {
    it('should validate URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
      expect(isValidUrl('not-a-url')).toBe(false);
    });
  });

  describe('parseRobotsText', () => {
    it('should parse robots.txt', () => {
      const robotsTxt = `User-agent: *
Disallow: /admin
Allow: /public
Sitemap: https://example.com/sitemap.xml`;

      const result = parseRobotsText(robotsTxt);
      expect(result.canCrawl('/public')).toBe(true);
      expect(result.canCrawl('/admin')).toBe(false);
      expect(result.canSitemap).toBe(true);
    });
  });
});
