import { describe, expect, it } from 'vitest';
import { validateImageUrl } from '../src/lib/images.js';
import { parseRoute, recordHash, searchHash } from '../src/lib/router.js';

describe('hash routing', () => {
  it('round-trips search and detail state', () => {
    const search = searchHash('西洋 血潮', 3);
    expect(parseRoute(search)).toEqual({ name: 'search', query: '西洋 血潮', page: 3 });

    const detail = recordHash('IA/TEST', '西洋 血潮', 3);
    expect(parseRoute(detail)).toEqual({
      name: 'record',
      id: 'IA/TEST',
      returnQuery: '西洋 血潮',
      returnPage: 3,
    });
  });

  it('uses safe defaults for invalid pages and encoded IDs', () => {
    expect(parseRoute('#/search?page=0')).toEqual({ name: 'search', query: '', page: 1 });
    expect(parseRoute('#/records/%E0%A4%A')).toEqual({ name: 'not-found' });
    expect(parseRoute('#/unknown')).toEqual({ name: 'not-found' });
  });
});

describe('image URL validation', () => {
  it('accepts only absolute HTTP(S) JPG URLs', () => {
    expect(validateImageUrl('https://example.test/image.jpg?size=large')).toEqual({
      kind: 'valid',
      url: 'https://example.test/image.jpg?size=large',
    });
    expect(validateImageUrl('javascript:alert(1)')).toMatchObject({ kind: 'invalid' });
    expect(validateImageUrl('https://example.test/image.png')).toMatchObject({ kind: 'invalid' });
    expect(validateImageUrl(null)).toEqual({ kind: 'none' });
  });
});
