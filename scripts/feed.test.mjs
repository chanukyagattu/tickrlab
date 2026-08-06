import { describe, expect, it } from 'vitest';
import { parseFeed } from './fetch-news.mjs';

describe('parseFeed', () => {
  it('parses RSS 2.0 items', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title>Memory pricing firms into Q4</title>
        <link>https://example.com/a</link>
        <pubDate>Wed, 05 Aug 2026 14:30:00 GMT</pubDate>
      </item>
    </channel></rss>`;

    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Memory pricing firms into Q4');
    expect(items[0].link).toBe('https://example.com/a');
    expect(items[0].time).toBe(Date.parse('2026-08-05T14:30:00Z') / 1000);
  });

  it('parses Atom entries with href-style links, as EDGAR returns', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>8-K - NVIDIA CORP (0001045810) (Filer)</title>
        <link rel="alternate" href="https://www.sec.gov/filing/1"/>
        <updated>2026-08-05T13:05:00-04:00</updated>
      </entry>
    </feed>`;

    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe('https://www.sec.gov/filing/1');
  });

  it('unwraps CDATA', () => {
    const xml = `<rss><channel><item>
      <title><![CDATA[Yields edge higher & stocks slip]]></title>
      <link>https://example.com/b</link>
      <pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;

    expect(parseFeed(xml)[0].title).toBe('Yields edge higher & stocks slip');
  });

  it('decodes entities and strips stray markup', () => {
    const xml = `<rss><channel><item>
      <title>AT&amp;T &lt;b&gt;beats&lt;/b&gt; estimates</title>
      <link>https://example.com/c</link>
      <pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;

    expect(parseFeed(xml)[0].title).toBe('AT&T beats estimates');
  });

  it('drops items missing a title, link, or parseable date', () => {
    const xml = `<rss><channel>
      <item><link>https://example.com/d</link><pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate></item>
      <item><title>No link here</title><pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate></item>
      <item><title>Bad date</title><link>https://example.com/e</link><pubDate>not a date</pubDate></item>
      <item><title>Good</title><link>https://example.com/f</link><pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;

    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Good');
  });

  it('returns an empty array for a non-feed body rather than throwing', () => {
    // A rate-limit HTML page must degrade to "no items", which the caller
    // turns into a failed job — not a crash mid-pipeline.
    expect(parseFeed('<!DOCTYPE html><html><body>429</body></html>')).toEqual([]);
    expect(parseFeed('')).toEqual([]);
  });

  it('handles multiple items and preserves order of appearance', () => {
    const item = (n) => `<item>
      <title>Story ${n}</title><link>https://example.com/${n}</link>
      <pubDate>Wed, 0${n} Aug 2026 10:00:00 GMT</pubDate></item>`;
    const xml = `<rss><channel>${item(1)}${item(2)}${item(3)}</channel></rss>`;

    expect(parseFeed(xml).map((i) => i.title)).toEqual(['Story 1', 'Story 2', 'Story 3']);
  });
});
