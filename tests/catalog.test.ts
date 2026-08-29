import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDatabase,
  COLUMN_COUNT,
  CSV_HEADERS,
  DATABASE_NAME,
  parseCatalogCsv,
  SCHEMA_VERSION,
} from '../scripts/build-database.js';
import { buildSearchWhere } from '../src/lib/search.js';
import { DATABASE_APPLICATION_ID, DATABASE_METADATA_VERSION } from '../src/lib/types.js';

const samplePath = join(process.cwd(), 'sample.csv');
let temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories = [];
});

function makeRow(overrides: Record<number, string> = {}): string[] {
  const row = Array.from({ length: COLUMN_COUNT }, () => '');
  row[0] = 'TEST-00001';
  row[1] = '旧Ｃ';
  row[2] = '東洋文庫';
  row[3] = '1-1';
  row[4] = 'テスト作品<BR>二行目';
  row[5] = 'テスト編著者';
  row[6] = '刊・整版';
  row[7] = '文政６年';
  row[8] = '1巻1冊';
  row[9] = '全';
  row[10] = '縦18.4p×横12.5p';
  row[24] = 'http://image.nijl.ac.jp/card/0000101.jpg';
  row[25] = 'http://image.nijl.ac.jp/card/0000102.jpg';
  for (const [index, value] of Object.entries(overrides)) row[Number(index)] = value;
  return row;
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function makeCsv(rows: string[][]): string {
  return [CSV_HEADERS.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n');
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kotenkiroku-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('catalog CSV import', () => {
  it('imports the sample with the expected counts and metadata', async () => {
    const input = await readFile(samplePath, 'utf8');
    const warnings: string[] = [];
    const records = parseCatalogCsv(input, (message) => warnings.push(message));

    expect(records).toHaveLength(27);
    expect(warnings).toEqual([]);
    expect(records[0]).toMatchObject({
      id: '804002-00001',
      holdingInstitution: '宮内庁書陵部',
      workTitle: expect.stringContaining('<BR>'),
      editionDate: '文政６年刊',
    });
    const totalImages = records.reduce((total, record) => total + record.images.length, 0);
    expect(totalImages).toBe(43);
  });

  it('preserves quoted commas, empty cells, and Japanese text', () => {
    const [record] = parseCatalogCsv(
      makeCsv([makeRow({ 1: '', 2: '所蔵, 館', 4: '作品「甲」', 8: '' })]),
      () => undefined,
    );

    expect(record).toMatchObject({
      cardType: null,
      holdingInstitution: '所蔵, 館',
      workTitle: '作品「甲」',
      volumeQuantity: null,
    });
  });

  it('rejects malformed rows with their source line', () => {
    expect(() => parseCatalogCsv(`${CSV_HEADERS.join(',')}\nonly-one-field`)).toThrow('2行目');
    const wrongHeaders = CSV_HEADERS.map((header, index) => (index === 0 ? 'wrong-header' : header));
    expect(() => parseCatalogCsv(`${wrongHeaders.join(',')}\n${makeRow().join(',')}`)).toThrow('1行目');
    expect(() => parseCatalogCsv(makeCsv([makeRow({ 0: '' })]))).toThrow('調査カード整理番号が空');
    expect(() => parseCatalogCsv(makeCsv([makeRow(), makeRow({ 0: 'TEST-00001' })]))).toThrow('重複');
  });

  it('rejects invalid image URLs with their source line', () => {
    expect(() => parseCatalogCsv(makeCsv([makeRow({ 24: 'javascript:alert(1)' })]))).toThrow('画像1のURL');
    expect(() => parseCatalogCsv(makeCsv([makeRow({ 24: '/relative/path.jpg' })]))).toThrow('画像1のURL');
    expect(() => parseCatalogCsv(makeCsv([makeRow({ 24: 'http://example.com/image.png' })]))).toThrow('画像1のURL');
  });

  it('preserves original image positions when image 1 is blank', () => {
    const [record] = parseCatalogCsv(
      makeCsv([makeRow({ 24: '', 25: 'http://image.nijl.ac.jp/card/0000102.jpg' })]),
      () => undefined,
    );

    expect(record?.images).toEqual([
      { position: 2, url: 'http://image.nijl.ac.jp/card/0000102.jpg' },
    ]);
  });

  it('atomically writes a validated database and verifies FTS5', async () => {
    const directory = await createTemporaryDirectory();
    const outputPath = join(directory, 'data', 'kotenkiroku.sqlite');
    const metadataPath = join(directory, 'data', 'kotenkiroku-meta.json');
    const summary = await buildDatabase({ inputPath: samplePath, outputPath, metadataPath, warn: () => undefined });

    expect(summary.recordCount).toBe(27);
    expect(summary.metadataPath).toBe(metadataPath);
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).toEqual({
      version: DATABASE_METADATA_VERSION,
      records: 27,
    });
    const database = new Database(outputPath);
    try {
      expect(database.prepare('SELECT COUNT(*) FROM records').pluck().get()).toBe(27);
      expect(database.prepare('SELECT COUNT(*) FROM record_images').pluck().get()).toBe(43);
      expect(database.prepare('SELECT COUNT(*) FROM records_fts').pluck().get()).toBe(27);
      expect(database.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        database.prepare("SELECT value FROM metadata WHERE key = 'database_name'").pluck().get(),
      ).toBe(DATABASE_NAME);
      expect(
        database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").pluck().get(),
      ).toBe(String(SCHEMA_VERSION));

      const imageRows = database
        .prepare("SELECT position, url FROM record_images WHERE record_id = '804002-00001' ORDER BY position")
        .all();
      expect(imageRows).toEqual([
        { position: 1, url: 'http://image.nijl.ac.jp/~chosa/card_jpeg/804002/804002-0000101.jpg' },
        { position: 2, url: 'http://image.nijl.ac.jp/~chosa/card_jpeg/804002/804002-0000102.jpg' },
      ]);

      const noQuery = buildSearchWhere('');
      expect(database.prepare(`SELECT id FROM records AS r ${noQuery.where} ORDER BY r.id ASC`).all()).toHaveLength(27);
      const orderedIds = database
        .prepare(`SELECT id FROM records AS r ${noQuery.where} ORDER BY r.id ASC`)
        .all()
        .map((row) => (row as { id: string }).id);
      expect(orderedIds).toEqual([...orderedIds].sort());

      const longTerm = buildSearchWhere('文政６年');
      expect(database.prepare(`SELECT id FROM records AS r ${longTerm.where}`).all(...longTerm.bind)).toHaveLength(1);
      const shortTerm = buildSearchWhere('東洋文庫');
      expect(database.prepare(`SELECT id FROM records AS r ${shortTerm.where}`).all(...shortTerm.bind).length).toBeGreaterThan(0);
      const hostileTerm = buildSearchWhere('" OR 1=1 --');
      expect(database.prepare(`SELECT id FROM records AS r ${hostileTerm.where}`).all(...hostileTerm.bind).length).toBeLessThanOrEqual(27);
      expect(database.prepare('PRAGMA journal_mode').pluck().get()).toBe('delete');
      expect(database.prepare('PRAGMA application_id').pluck().get()).toBe(DATABASE_APPLICATION_ID);
      expect(database.prepare('PRAGMA user_version').pluck().get()).toBe(SCHEMA_VERSION);
    } finally {
      database.close();
    }
  });

  it('does not replace an existing database when input validation fails', async () => {
    const directory = await createTemporaryDirectory();
    const outputPath = join(directory, 'kotenkiroku.sqlite');
    const metadataPath = join(directory, 'kotenkiroku-meta.json');
    await buildDatabase({ inputPath: samplePath, outputPath, metadataPath, warn: () => undefined });
    const before = await readFile(outputPath);
    const metadataBefore = await readFile(metadataPath);
    const invalidPath = join(directory, 'invalid.csv');
    await writeFile(invalidPath, `${CSV_HEADERS.join(',')}\n${makeRow({ 0: '' }).join(',')}`, 'utf8');

    await expect(buildDatabase({ inputPath: invalidPath, outputPath, metadataPath, warn: () => undefined })).rejects.toThrow(
      '調査カード整理番号が空',
    );
    expect(await readFile(outputPath)).toEqual(before);
    expect(await readFile(metadataPath)).toEqual(metadataBefore);
  });
});
