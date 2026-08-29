import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_METADATA_VERSION,
  DATABASE_USER_VERSION,
  MAX_IMAGE_POSITION,
  MAX_RECORD_ID_LENGTH,
  type CatalogRecord,
  type RecordImage,
} from '../src/lib/types.js';
import { buildSearchText } from '../src/lib/search.js';

export const CSV_HEADERS = [
  '調査カード整理番号',
  'カード種別',
  '所蔵者名',
  '整理番号',
  '作品名',
  '編著者名',
  '写刊',
  '写刊年次',
  '巻数・数量',
  '残存',
  '寸法',
  '書型',
  '匡郭・界罫等',
  '表紙',
  '装訂／料紙',
  '保存状況',
  '箱・帙・袋・包紙',
  '蔵書印等',
  '序・跋・刊記・奥書等',
  '絵：記述',
  '書入：記述',
  '補記：記述',
  '書影タイトル',
  '書誌構成',
  '画像1',
  '画像2',
  '画像3',
  '画像4',
  '画像5',
  '画像6',
  '画像7',
  '画像8',
  '画像9',
  '画像10',
  '画像11',
  '画像12',
  '画像13',
  '画像14',
  '画像15',
  '画像16',
  '画像17',
  '画像18',
  '画像19',
  '画像20',
  '画像21',
  '画像22',
  '画像23',
  '画像24',
  '画像25',
  '画像26',
  '画像27',
  '画像28',
  '画像29',
  '画像30',
  '画像31',
  '画像32',
  '画像33',
  '画像34',
  '画像35',
  '画像36',
  '画像37',
  '画像38',
  '画像39',
  '画像40',
  '画像41',
  '画像42',
  '画像43',
  '画像44',
  '画像45',
  '画像46',
  '画像47',
  '画像48',
  '画像49',
  '画像50',
  '画像51',
  '画像52',
  '画像53',
  '画像54',
  '画像55',
  '画像56',
] as const;

const BIBLIOGRAPHIC_COLUMN_COUNT = 24;
const IMAGE_COLUMN_COUNT = MAX_IMAGE_POSITION;
export const COLUMN_COUNT = BIBLIOGRAPHIC_COLUMN_COUNT + IMAGE_COLUMN_COUNT;

export const DATABASE_NAME = '日本古典資料調査記録データベース';
export const SCHEMA_VERSION = 1;

const DEFAULT_INPUT_PATH = 'sample.csv';
const DEFAULT_OUTPUT_PATH = 'public/data/kotenkiroku.sqlite';
const DEFAULT_METADATA_PATH = 'public/data/kotenkiroku-meta.json';
const MAX_RECORD_SIZE = 16 * 1024 * 1024;

interface ParsedCsvRow {
  values: string[];
  line: number;
}

export interface BuildOptions {
  inputPath: string;
  outputPath?: string;
  metadataPath?: string;
  warn?: (message: string) => void;
}

export interface BuildSummary {
  inputPath: string;
  outputPath: string;
  metadataPath: string;
  recordCount: number;
}

class CatalogInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogInputError';
  }
}

function decodeUtf8(input: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new CatalogInputError('CSVをUTF-8として読み込めません。');
  }
}

function parseCsvRows(input: string): ParsedCsvRow[] {
  const lines: number[] = [];
  let values: string[][];

  try {
    values = parse(input, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: MAX_RECORD_SIZE,
      relax_column_count: false,
      on_record(record, context) {
        lines.push(context.lines);
        return record;
      },
    });
  } catch (error: unknown) {
    const line = getCsvErrorLine(error);
    const location = line === undefined ? '' : `（${line}行目）`;
    throw new CatalogInputError(`CSVの形式が不正です${location}。`);
  }

  return values.map((row, index) => ({
    values: [...row],
    line: lines[index] ?? index + 1,
  }));
}

function getCsvErrorLine(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('lines' in error)) return undefined;
  const line = error.lines;
  return typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? line : undefined;
}

function assertHeader(row: ParsedCsvRow): void {
  if (row.values.length !== CSV_HEADERS.length || !row.values.every((value, index) => value === CSV_HEADERS[index])) {
    throw new CatalogInputError(`CSVヘッダーが不一致です（${row.line}行目）。`);
  }
}

export function isAbsoluteJpegUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.pathname.toLowerCase().endsWith('.jpg');
}

function validateImageUrl(value: string, position: number, line: number): string {
  if (!isAbsoluteJpegUrl(value)) {
    throw new CatalogInputError(
      `画像${position}のURLが不正です（${line}行目）。HTTPまたはHTTPSの.jpg画像を指定してください。`,
    );
  }
  return value;
}

function mapRecord(row: ParsedCsvRow): CatalogRecord {
  if (row.values.length !== CSV_HEADERS.length) {
    throw new CatalogInputError(`${COLUMN_COUNT}列ではありません（${row.line}行目）。`);
  }

  const value = (index: number): string => row.values[index] ?? '';
  const id = value(0);
  if (id.trim() === '') throw new CatalogInputError(`調査カード整理番号が空です（${row.line}行目）。`);
  if (id.length > MAX_RECORD_ID_LENGTH) {
    throw new CatalogInputError(`調査カード整理番号が長すぎます（${row.line}行目）。`);
  }

  const images: RecordImage[] = [];
  for (let position = 1; position <= IMAGE_COLUMN_COUNT; position += 1) {
    const url = value(BIBLIOGRAPHIC_COLUMN_COUNT + position - 1);
    if (url.trim() === '') continue;
    images.push({ position, url: validateImageUrl(url, position, row.line) });
  }

  return {
    id,
    cardType: value(1) || null,
    holdingInstitution: value(2) || null,
    shelfmark: value(3) || null,
    workTitle: value(4) || null,
    author: value(5) || null,
    editionType: value(6) || null,
    editionDate: value(7) || null,
    volumeQuantity: value(8) || null,
    survival: value(9) || null,
    dimensions: value(10) || null,
    bookFormat: value(11) || null,
    frameRuling: value(12) || null,
    cover: value(13) || null,
    bindingPaper: value(14) || null,
    condition: value(15) || null,
    container: value(16) || null,
    ownershipMarks: value(17) || null,
    prefaceColophon: value(18) || null,
    pictureDescription: value(19) || null,
    inscriptionDescription: value(20) || null,
    supplement: value(21) || null,
    imageTitle: value(22) || null,
    bibliographicStructure: value(23) || null,
    images,
  };
}

export function parseCatalogCsv(input: string, warn = console.warn): CatalogRecord[] {
  const rows = parseCsvRows(input);
  const header = rows[0];
  if (header === undefined) throw new CatalogInputError('CSVにヘッダーがありません。');
  assertHeader(header);

  const records: CatalogRecord[] = [];
  const seenIds = new Map<string, number>();

  for (const row of rows.slice(1)) {
    if (
      row.values.length === CSV_HEADERS.length &&
      row.values.every((value, index) => value === CSV_HEADERS[index])
    ) {
      warn(`再掲ヘッダーを読み飛ばしました（${row.line}行目）。`);
      continue;
    }
    if (row.values[0] === CSV_HEADERS[0]) {
      throw new CatalogInputError(`CSVヘッダーが不一致です（${row.line}行目）。`);
    }

    const record = mapRecord(row);
    const firstLine = seenIds.get(record.id);
    if (firstLine !== undefined) {
      throw new CatalogInputError(
        `調査カード整理番号が重複しています（${row.line}行目、最初は${firstLine}行目）。`,
      );
    }
    seenIds.set(record.id, row.line);
    records.push(record);
  }

  return records;
}

function createSchema(database: Database.Database): void {
  database.pragma('journal_mode = DELETE');
  database.pragma('foreign_keys = ON');
  database.pragma(`application_id = ${DATABASE_APPLICATION_ID}`);
  database.pragma(`user_version = ${DATABASE_USER_VERSION}`);
  database.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE records (
      id TEXT PRIMARY KEY,
      card_type TEXT,
      holding_institution TEXT,
      shelfmark TEXT,
      work_title TEXT,
      author TEXT,
      edition_type TEXT,
      edition_date TEXT,
      volume_quantity TEXT,
      survival TEXT,
      dimensions TEXT,
      book_format TEXT,
      frame_ruling TEXT,
      cover TEXT,
      binding_paper TEXT,
      condition TEXT,
      container TEXT,
      ownership_marks TEXT,
      preface_colophon TEXT,
      picture_description TEXT,
      inscription_description TEXT,
      supplement TEXT,
      image_title TEXT,
      bibliographic_structure TEXT,
      search_text TEXT NOT NULL
    );

    CREATE TABLE record_images (
      record_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position BETWEEN 1 AND ${MAX_IMAGE_POSITION}),
      url TEXT NOT NULL,
      PRIMARY KEY (record_id, position),
      FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
    );

    CREATE INDEX record_images_record_position
      ON record_images (record_id, position);

    CREATE VIRTUAL TABLE records_fts USING fts5(
      id UNINDEXED,
      search_text,
      tokenize = 'trigram'
    );
  `);
}

function insertRecords(database: Database.Database, records: CatalogRecord[]): void {
  const insertMetadataStatement = database.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  const insertRecord = database.prepare(`
    INSERT INTO records (
      id, card_type, holding_institution, shelfmark, work_title, author,
      edition_type, edition_date, volume_quantity, survival, dimensions,
      book_format, frame_ruling, cover, binding_paper, condition, container,
      ownership_marks, preface_colophon, picture_description,
      inscription_description, supplement, image_title, bibliographic_structure,
      search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImage = database.prepare(
    'INSERT INTO record_images (record_id, position, url) VALUES (?, ?, ?)',
  );
  const insertFts = database.prepare(
    'INSERT INTO records_fts (id, search_text) VALUES (?, ?)',
  );

  database.exec('BEGIN');
  try {
    insertMetadataStatement.run('database_name', DATABASE_NAME);
    insertMetadataStatement.run('schema_version', String(SCHEMA_VERSION));
    for (const record of records) {
      const searchText = buildSearchText(record);
      insertRecord.run(
        record.id,
        record.cardType,
        record.holdingInstitution,
        record.shelfmark,
        record.workTitle,
        record.author,
        record.editionType,
        record.editionDate,
        record.volumeQuantity,
        record.survival,
        record.dimensions,
        record.bookFormat,
        record.frameRuling,
        record.cover,
        record.bindingPaper,
        record.condition,
        record.container,
        record.ownershipMarks,
        record.prefaceColophon,
        record.pictureDescription,
        record.inscriptionDescription,
        record.supplement,
        record.imageTitle,
        record.bibliographicStructure,
        searchText,
      );
      for (const image of record.images) {
        insertImage.run(record.id, image.position, image.url);
      }
      insertFts.run(record.id, searchText);
    }
    database.exec('COMMIT');
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The original insertion error is the useful failure for the caller.
    }
    throw error;
  }
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`生成したSQLiteの${fieldName}が不正です。`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`生成したSQLiteの${fieldName}が不正です。`);
  }
  return value;
}

function validateImagePositions(
  database: Database.Database,
  expectedImageCount: number,
  expectedRecordCount: number,
): void {
  const imageCount = readNonNegativeInteger(
    database.prepare('SELECT COUNT(*) FROM record_images').pluck().get(),
    '画像件数',
  );
  if (imageCount !== expectedImageCount) {
    throw new Error(`record_imagesの件数が一致しません（actual=${imageCount}, expected=${expectedImageCount}）。`);
  }

  const outOfRange = readNonNegativeInteger(
    database.prepare('SELECT COUNT(*) FROM record_images WHERE position < 1 OR position > ?').pluck().get(MAX_IMAGE_POSITION),
    '範囲外画像位置',
  );
  if (outOfRange !== 0) {
    throw new Error(`record_imagesに範囲外の位置があります（${outOfRange}件）。`);
  }

  const orphanCount = readNonNegativeInteger(
    database
      .prepare('SELECT COUNT(*) FROM record_images AS i LEFT JOIN records AS r ON r.id = i.record_id WHERE r.id IS NULL')
      .pluck()
      .get(),
    '孤児画像',
  );
  if (orphanCount !== 0) {
    throw new Error(`record_imagesに孤児画像があります（${orphanCount}件）。`);
  }

  const distinctIds = database.prepare('SELECT COUNT(DISTINCT record_id) FROM record_images').pluck().get();
  if (typeof distinctIds !== 'number') {
    throw new Error('record_imagesの識別子が不正です。');
  }
  if (distinctIds > expectedRecordCount) {
    throw new Error(`record_imagesが資料を超えて参照しています（${distinctIds}件）。`);
  }
}

export function validateDatabase(
  database: Database.Database,
  expectedCount: number,
  expectedImageCount: number,
): void {
  const applicationId = readNonNegativeInteger(
    database.prepare('PRAGMA application_id').pluck().get(),
    'application_id',
  );
  if (applicationId !== DATABASE_APPLICATION_ID) {
    throw new Error(`SQLite application_idが一致しません（${applicationId}）。`);
  }
  const userVersion = readNonNegativeInteger(
    database.prepare('PRAGMA user_version').pluck().get(),
    'user_version',
  );
  if (userVersion !== DATABASE_USER_VERSION) {
    throw new Error(`SQLite user_versionが一致しません（${userVersion}）。`);
  }

  const integrity = database.prepare('PRAGMA integrity_check').pluck().get();
  if (integrity !== 'ok') throw new Error('SQLite integrity_checkに失敗しました。');

  const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyRows.length !== 0) {
    throw new Error(`SQLite foreign_key_checkに失敗しました（${foreignKeyRows.length}件）。`);
  }

  const databaseName = readString(
    database.prepare("SELECT value FROM metadata WHERE key = 'database_name'").pluck().get(),
    'metadata.database_name',
  );
  if (databaseName !== DATABASE_NAME) {
    throw new Error(`metadata.database_nameが一致しません（${databaseName}）。`);
  }
  const schemaVersion = readString(
    database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").pluck().get(),
    'metadata.schema_version',
  );
  if (schemaVersion !== String(SCHEMA_VERSION)) {
    throw new Error(`metadata.schema_versionが一致しません（${schemaVersion}）。`);
  }

  const recordCount = readNonNegativeInteger(
    database.prepare('SELECT COUNT(*) FROM records').pluck().get(),
    'レコード件数',
  );
  const ftsCount = readNonNegativeInteger(
    database.prepare('SELECT COUNT(*) FROM records_fts').pluck().get(),
    'FTS件数',
  );
  if (recordCount !== expectedCount || ftsCount !== expectedCount || recordCount !== ftsCount) {
    throw new Error(
      `SQLiteの件数が一致しません（records=${recordCount}, records_fts=${ftsCount}, expected=${expectedCount}）。`,
    );
  }

  validateImagePositions(database, expectedImageCount, expectedCount);

  database.prepare('SELECT id FROM records_fts WHERE records_fts MATCH ? LIMIT 1').all('"abc"');
}

async function makeTemporaryPath(outputPath: string): Promise<string> {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${outputPath}.tmp-${suffix}`;
}

async function writeMetadata(metadataPath: string, recordCount: number): Promise<void> {
  await mkdir(dirname(metadataPath), { recursive: true });
  const temporaryPath = await makeTemporaryPath(metadataPath);
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: DATABASE_METADATA_VERSION, records: recordCount })}\n`,
      'utf8',
    );
    await rename(temporaryPath, metadataPath);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function buildDatabase(options: BuildOptions): Promise<BuildSummary> {
  const inputPath = resolve(options.inputPath);
  const outputPath = resolve(options.outputPath ?? DEFAULT_OUTPUT_PATH);
  const metadataPath = resolve(
    options.metadataPath
      ?? (outputPath === resolve(DEFAULT_OUTPUT_PATH) ? DEFAULT_METADATA_PATH : `${outputPath}.meta.json`),
  );
  const input = decodeUtf8(await readFile(inputPath));
  const records = parseCatalogCsv(input, options.warn ?? console.warn);
  const expectedImageCount = records.reduce((total, record) => total + record.images.length, 0);

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = await makeTemporaryPath(outputPath);
  let database: Database.Database | undefined;

  try {
    database = new Database(temporaryPath);
    createSchema(database);
    insertRecords(database, records);
    validateDatabase(database, records.length, expectedImageCount);
    database.close();
    database = undefined;
    await rename(temporaryPath, outputPath);
    await writeMetadata(metadataPath, records.length);
    return { inputPath, outputPath, metadataPath, recordCount: records.length };
  } catch (error: unknown) {
    if (database?.open) database.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

interface CliOptions {
  inputPath: string;
  outputPath: string;
}

function parseCliOptions(args: string[], environment: NodeJS.ProcessEnv): CliOptions {
  let inputPath = environment.KOTENKIROKU_CSV ?? DEFAULT_INPUT_PATH;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--input' || argument === '--output') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument}にはパスが必要です。`);
      }
      if (argument === '--input') inputPath = value;
      else outputPath = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith('--input=')) {
      inputPath = argument.slice('--input='.length);
      continue;
    }
    if (argument?.startsWith('--output=')) {
      outputPath = argument.slice('--output='.length);
      continue;
    }
    if (argument === '--help') {
      throw new Error('使い方: npm run db:build -- [--input path] [--output path]');
    }
    throw new Error(`不明なオプションです: ${argument ?? ''}`);
  }

  return { inputPath, outputPath };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2), process.env);
  const summary = await buildDatabase(options);
  console.log(`${summary.recordCount}件のSQLiteデータベースを生成しました: ${summary.outputPath}`);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'データベース生成に失敗しました。';
    console.error(message);
    process.exitCode = 1;
  });
}
