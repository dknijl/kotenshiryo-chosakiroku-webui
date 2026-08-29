import { describe, expect, it } from 'vitest';
import {
  buildSearchText,
  buildSearchWhere,
  isTrigramSearchTerm,
  makeExcerpt,
  normalizeSearchText,
  splitSearchTerms,
  toDisplayText,
  toFtsPhrase,
  toTitleText,
} from '../src/lib/search.js';
import type { CatalogRecord } from '../src/lib/types.js';

const record: CatalogRecord = {
  id: 'TEST-00001',
  cardType: '旧Ｃ',
  holdingInstitution: '東洋文庫',
  shelfmark: '1-1',
  workTitle: '作品名<BR>二行目',
  author: '編著者甲',
  editionType: '写本',
  editionDate: '文政６年',
  volumeQuantity: null,
  survival: '全',
  dimensions: '縦18.4p×横12.5p',
  bookFormat: null,
  frameRuling: null,
  cover: null,
  bindingPaper: null,
  condition: null,
  container: null,
  ownershipMarks: null,
  prefaceColophon: null,
  pictureDescription: null,
  inscriptionDescription: null,
  supplement: null,
  imageTitle: null,
  bibliographicStructure: null,
  images: [
    { position: 1, url: 'http://image.nijl.ac.jp/card/0000101.jpg' },
    { position: 2, url: 'http://image.nijl.ac.jp/card/0000102.jpg' },
  ],
};

describe('search normalization', () => {
  it('normalizes only search/display projections and turns BR into line breaks', () => {
    expect(normalizeSearchText('ＡＢＣ<BR>ＤＥＦ')).toBe('ABC\nDEF');
    expect(toDisplayText('ＡＢＣ<BR>ＤＥＦ')).toBe('ＡＢＣ\nＤＥＦ');
    expect(toTitleText('ＡＢＣ<BR>ＤＥＦ')).toBe('ＡＢＣ ＤＥＦ');
  });

  it('builds search text from id and bibliographic fields, excluding image URLs', () => {
    const searchText = buildSearchText(record);
    expect(searchText).toContain('編著者甲');
    expect(searchText).toContain('作品名\n二行目');
    expect(searchText).toContain('TEST-00001');
    expect(searchText).not.toContain('image.nijl.ac.jp');
    expect(searchText).not.toContain('0000101.jpg');
    expect(record.workTitle).toBe('作品名<BR>二行目');
  });

  it('splits AND terms and selects trigram versus short-term search', () => {
    expect(splitSearchTerms(' ＡＢＣ  作品 ')).toEqual(['ABC', '作品']);
    expect(isTrigramSearchTerm('ABC')).toBe(true);
    expect(isTrigramSearchTerm('本')).toBe(false);
    expect(isTrigramSearchTerm('二\u0000行')).toBe(false);

    expect(buildSearchWhere('東洋 文庫')).toEqual({
      where:
        'WHERE instr(r.search_text, ?) > 0 AND instr(r.search_text, ?) > 0',
      bind: ['東洋', '文庫'],
    });
    expect(buildSearchWhere('編著者').where).toBe(
      'WHERE r.id IN (SELECT f.id FROM records_fts AS f WHERE records_fts MATCH ?)',
    );
    expect(buildSearchWhere('本').where).toBe('WHERE instr(r.search_text, ?) > 0');
  });

  it('quotes FTS input instead of concatenating SQLite syntax', () => {
    expect(toFtsPhrase('a" OR *')).toBe('"a"" OR *"');
  });

  it('creates a bounded readable excerpt', () => {
    expect(makeExcerpt('一<BR>二')).toBe('一 二');
    expect(makeExcerpt('あいうえお', 3)).toBe('あいう…');
  });
});
