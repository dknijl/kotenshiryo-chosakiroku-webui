import { createHttpBackend, initSyncSQLite } from 'sqlite-wasm-http';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_USER_VERSION,
  isDatabaseWorkerRequest,
  MAX_IMAGE_POSITION,
  PAGE_SIZE,
  MAX_PAGE,
  type CatalogRecord,
  type DatabaseErrorPhase,
  type DatabaseWorkerRequest,
  type RecordImage,
  type SearchPage,
  type SearchResult,
} from './types.js';
import { buildSearchWhere } from './search.js';
import { fetchDatabaseSource } from './database-http.js';

type Sqlite3 = Awaited<ReturnType<typeof initSyncSQLite>>;
type SqliteDatabase = InstanceType<Sqlite3['oo1']['DB']>;
type HttpBackend = ReturnType<typeof createHttpBackend>;
type SqlValue = string | number | boolean | bigint | Uint8Array | null;
type SqlRow = Record<string, SqlValue>;
type SqliteDatabaseWithClose = SqliteDatabase & {
  onclose?: { after?: () => void };
};
type SqliteRuntime = Sqlite3 & {
  capi: Sqlite3['capi'] & {
    SQLITE_DESERIALIZE_READONLY: number;
    sqlite3_deserialize: (
      database: SqliteDatabase,
      schema: string,
      data: unknown,
      databaseSize: number,
      bufferSize: number,
      flags: number,
    ) => number;
    sqlite3_errmsg: (database: SqliteDatabase) => string;
  };
  wasm: Sqlite3['wasm'] & {
    allocFromTypedArray: (bytes: Uint8Array) => unknown;
    dealloc: (pointer: unknown) => void;
  };
};

let database: SqliteDatabase | undefined;
let httpBackend: HttpBackend | undefined;
let databaseTotal = 0;

function postError(requestId: number, phase: DatabaseErrorPhase, message: string): void {
  self.postMessage({ type: 'error', requestId, phase, message });
}

function errorMessage(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message.trim().slice(0, 160) : '';
  return detail === '' ? fallback : `${fallback} ${detail}`;
}

async function closeDatabase(): Promise<void> {
  const current = database;
  const currentHttpBackend = httpBackend;
  database = undefined;
  httpBackend = undefined;
  databaseTotal = 0;
  try {
    current?.close();
  } finally {
    if (currentHttpBackend !== undefined) await currentHttpBackend.close();
  }
}

function readRequiredString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`SQLite列${key}の値が不正です。`);
  return value;
}

function readNullableString(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`SQLite列${key}の値が不正です。`);
  return value;
}

function readNonNegativeInteger(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`SQLite列${key}の値が不正です。`);
  }
  return value;
}

async function readRows(
  databaseHandle: SqliteDatabase,
  sql: string,
  bind: readonly (string | number)[] = [],
): Promise<SqlRow[]> {
  return databaseHandle.exec(sql, { bind: [...bind], rowMode: 'object' });
}

async function getCount(
  databaseHandle: SqliteDatabase,
  sql: string,
  bind: readonly (string | number)[] = [],
): Promise<number> {
  const rows = await readRows(databaseHandle, sql, bind);
  const row = rows[0];
  if (row === undefined) throw new Error('SQLiteの件数を取得できません。');
  return readNonNegativeInteger(row, 'total');
}

async function readCompatibilityPragma(databaseHandle: SqliteDatabase, name: string): Promise<number> {
  const rows = await readRows(databaseHandle, `PRAGMA ${name}`);
  const row = rows[0];
  if (row === undefined) throw new Error(`SQLiteの${name}を取得できません。`);
  return readNonNegativeInteger(row, name);
}

async function validateDatabaseCompatibility(databaseHandle: SqliteDatabase): Promise<void> {
  const applicationId = await readCompatibilityPragma(databaseHandle, 'application_id');
  if (applicationId !== DATABASE_APPLICATION_ID) {
    throw new Error(`SQLiteのapplication_idが一致しません（${applicationId}）。`);
  }

  const userVersion = await readCompatibilityPragma(databaseHandle, 'user_version');
  if (userVersion !== DATABASE_USER_VERSION) {
    throw new Error(`SQLiteのuser_versionが一致しません（${userVersion}）。`);
  }
}

function openSerializedDatabase(sqlite3: Sqlite3, bytes: Uint8Array): SqliteDatabase {
  const runtime = sqlite3 as SqliteRuntime;
  const nextDatabase = new sqlite3.oo1.DB(':memory:', 'r' as unknown as number) as SqliteDatabaseWithClose;
  try {
    const dataPointer = runtime.wasm.allocFromTypedArray(bytes);
    nextDatabase.onclose = {
      after: () => runtime.wasm.dealloc(dataPointer),
    };
    const result = runtime.capi.sqlite3_deserialize(
      nextDatabase,
      'main',
      dataPointer,
      bytes.byteLength,
      bytes.byteLength,
      runtime.capi.SQLITE_DESERIALIZE_READONLY,
    );
    if (result !== runtime.capi.SQLITE_OK) {
      throw new Error(`SQLiteデータベースをメモリに読み込めません（${runtime.capi.sqlite3_errmsg(nextDatabase)}）。`);
    }
    return nextDatabase;
  } catch (error: unknown) {
    nextDatabase.close();
    throw error;
  }
}

async function initializeDatabase(databaseUrl: string, total: number): Promise<number> {
  let nextDatabase: SqliteDatabase | undefined;
  let nextHttpBackend: HttpBackend | undefined;
  try {
    const source = await fetchDatabaseSource(databaseUrl);
    let sqlite3: Sqlite3;
    if (source.kind === 'range') {
      nextHttpBackend = createHttpBackend({
        backendType: 'sync',
        maxPageSize: 4_096,
        cacheSize: 4_096,
        timeout: 30_000,
      });
      sqlite3 = await initSyncSQLite({ http: nextHttpBackend });
      nextDatabase = new sqlite3.oo1.DB({
        filename: `file:${encodeURI(databaseUrl)}`,
        // The runtime accepts string open flags although the bundled declaration says number.
        flags: 'r' as unknown as number,
        vfs: 'http',
      });
    } else {
      sqlite3 = await initSyncSQLite();
      nextDatabase = openSerializedDatabase(sqlite3, source.bytes);
    }
    await validateDatabaseCompatibility(nextDatabase);
    await closeDatabase();
    database = nextDatabase;
    httpBackend = nextHttpBackend;
    nextDatabase = undefined;
    nextHttpBackend = undefined;
    databaseTotal = total;
    return total;
  } finally {
    try {
      nextDatabase?.close();
    } finally {
      if (nextHttpBackend !== undefined) await nextHttpBackend.close();
    }
  }
}

function toSearchResult(row: SqlRow): SearchResult {
  return {
    id: readRequiredString(row, 'id'),
    workTitle: readNullableString(row, 'work_title'),
    holdingInstitution: readNullableString(row, 'holding_institution'),
    author: readNullableString(row, 'author'),
    editionDate: readNullableString(row, 'edition_date'),
    firstImageUrl: readNullableString(row, 'first_image_url'),
  };
}

async function searchDatabase(
  databaseHandle: SqliteDatabase,
  query: string,
  page: number,
  total: number,
): Promise<SearchPage> {
  if (page > MAX_PAGE) throw new Error('ページ番号が範囲外です。');
  const search = buildSearchWhere(query);
  const resultTotal = search.where === ''
    ? total
    : await getCount(
      databaseHandle,
      `SELECT COUNT(*) AS total FROM records AS r ${search.where}`,
      search.bind,
    );
  const offset = (page - 1) * PAGE_SIZE;
  const rows = await readRows(
    databaseHandle,
    `
      SELECT r.id, r.work_title, r.holding_institution, r.author, r.edition_date,
        (SELECT i.url FROM record_images AS i WHERE i.record_id = r.id ORDER BY i.position ASC LIMIT 1) AS first_image_url
      FROM records AS r
      ${search.where}
      ORDER BY r.id ASC
      LIMIT ? OFFSET ?
    `,
    [...search.bind, PAGE_SIZE, offset],
  );

  return {
    query,
    page,
    pageSize: PAGE_SIZE,
    total: resultTotal,
    records: rows.map(toSearchResult),
  };
}

async function getImages(databaseHandle: SqliteDatabase, id: string): Promise<RecordImage[]> {
  const rows = await readRows(
    databaseHandle,
    `
      SELECT position, url FROM record_images
      WHERE record_id = ?
      ORDER BY position ASC
    `,
    [id],
  );
  return rows.map((row) => ({
    position: readRequiredImagePosition(row, 'position'),
    url: readRequiredString(row, 'url'),
  }));
}

function readRequiredImagePosition(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_IMAGE_POSITION) {
    throw new Error(`SQLite列${key}の値が不正です。`);
  }
  return value;
}

async function getRecord(databaseHandle: SqliteDatabase, id: string): Promise<CatalogRecord | null> {
  const rows = await readRows(
    databaseHandle,
    `
      SELECT id, card_type, holding_institution, shelfmark, work_title, author,
        edition_type, edition_date, volume_quantity, survival, dimensions,
        book_format, frame_ruling, cover, binding_paper, condition, container,
        ownership_marks, preface_colophon, picture_description,
        inscription_description, supplement, image_title, bibliographic_structure
      FROM records
      WHERE id = ?
    `,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: readRequiredString(row, 'id'),
    cardType: readNullableString(row, 'card_type'),
    holdingInstitution: readNullableString(row, 'holding_institution'),
    shelfmark: readNullableString(row, 'shelfmark'),
    workTitle: readNullableString(row, 'work_title'),
    author: readNullableString(row, 'author'),
    editionType: readNullableString(row, 'edition_type'),
    editionDate: readNullableString(row, 'edition_date'),
    volumeQuantity: readNullableString(row, 'volume_quantity'),
    survival: readNullableString(row, 'survival'),
    dimensions: readNullableString(row, 'dimensions'),
    bookFormat: readNullableString(row, 'book_format'),
    frameRuling: readNullableString(row, 'frame_ruling'),
    cover: readNullableString(row, 'cover'),
    bindingPaper: readNullableString(row, 'binding_paper'),
    condition: readNullableString(row, 'condition'),
    container: readNullableString(row, 'container'),
    ownershipMarks: readNullableString(row, 'ownership_marks'),
    prefaceColophon: readNullableString(row, 'preface_colophon'),
    pictureDescription: readNullableString(row, 'picture_description'),
    inscriptionDescription: readNullableString(row, 'inscription_description'),
    supplement: readNullableString(row, 'supplement'),
    imageTitle: readNullableString(row, 'image_title'),
    bibliographicStructure: readNullableString(row, 'bibliographic_structure'),
    images: await getImages(databaseHandle, id),
  };
}

async function handleRequest(request: DatabaseWorkerRequest): Promise<void> {
  if (request.type === 'initialize') {
    try {
      const total = await initializeDatabase(request.databaseUrl, request.total);
      self.postMessage({ type: 'initialized', requestId: request.requestId, total });
    } catch (error: unknown) {
      postError(request.requestId, 'database', errorMessage(error, 'データベースの初期化に失敗しました。'));
    }
    return;
  }

  const currentDatabase = database;
  if (currentDatabase === undefined) {
    postError(request.requestId, 'query', 'データベースが初期化されていません。');
    return;
  }

  try {
    if (request.type === 'search') {
      self.postMessage({
        type: 'search-result',
        requestId: request.requestId,
        result: await searchDatabase(currentDatabase, request.query, request.page, databaseTotal),
      });
    } else if (request.type === 'count') {
      self.postMessage({
        type: 'count-result',
        requestId: request.requestId,
        total: databaseTotal,
      });
    } else {
      self.postMessage({
        type: 'record-result',
        requestId: request.requestId,
        record: await getRecord(currentDatabase, request.id),
      });
    }
  } catch (error: unknown) {
    postError(request.requestId, 'query', errorMessage(error, 'SQLiteの検索処理に失敗しました。'));
  }
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isDatabaseWorkerRequest(event.data)) {
    console.error('不正なデータベースWorkerメッセージを受信しました。');
    return;
  }
  void handleRequest(event.data);
});
