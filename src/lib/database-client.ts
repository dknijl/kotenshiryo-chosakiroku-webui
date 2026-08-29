import {
  isDatabaseWorkerResponse,
  type CatalogRecord,
  type DatabaseErrorPhase,
  type DatabaseWorkerRequest,
  type DatabaseWorkerResponse,
  DATABASE_METADATA_VERSION,
  type SearchPage,
} from './types.js';

interface PendingRequest {
  resolve: (response: DatabaseWorkerResponse) => void;
  reject: (error: Error) => void;
}

export class DatabaseClientError extends Error {
  readonly phase: DatabaseErrorPhase | 'protocol';

  constructor(phase: DatabaseErrorPhase | 'protocol', message: string) {
    super(message);
    this.name = 'DatabaseClientError';
    this.phase = phase;
  }
}

function protocolError(message: string): DatabaseClientError {
  return new DatabaseClientError('protocol', message);
}

function responseError(response: DatabaseWorkerResponse): never {
  if (response.type !== 'error') {
    throw protocolError('データベースWorkerから予期しない応答を受信しました。');
  }
  throw new DatabaseClientError(response.phase, response.message);
}

function databaseUrl(): string {
  const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI);
  return new URL('data/kotenkiroku.sqlite', baseUrl).toString();
}

function metadataUrl(): string {
  const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI);
  return new URL('data/kotenkiroku-meta.json', baseUrl).toString();
}

function readMetadataTotal(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatabaseClientError('database', 'データベース件数メタデータの形式が不正です。');
  }
  const metadata = value as { version?: unknown; records?: unknown };
  if (
    metadata.version !== DATABASE_METADATA_VERSION ||
    typeof metadata.records !== 'number' ||
    !Number.isSafeInteger(metadata.records) ||
    metadata.records < 0
  ) {
    throw new DatabaseClientError('database', 'データベース件数メタデータの値が不正です。');
  }
  return metadata.records;
}

async function fetchMetadataTotal(): Promise<number> {
  let response: Response;
  try {
    response = await fetch(metadataUrl(), { credentials: 'same-origin' });
  } catch (error: unknown) {
    throw new DatabaseClientError(
      'database',
      error instanceof Error ? error.message : 'データベース件数メタデータを取得できません。',
    );
  }
  if (!response.ok) {
    throw new DatabaseClientError('database', `データベース件数メタデータを取得できません（HTTP ${response.status}）。`);
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new DatabaseClientError('database', 'データベース件数メタデータを解析できません。');
  }
  return readMetadataTotal(value);
}

export interface SearchRequest {
  requestId: number;
  promise: Promise<SearchPage>;
}

export class DatabaseClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor() {
    this.worker = new Worker(new URL('./database.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.handleMessage(event.data);
    });
    this.worker.addEventListener('error', () => {
      this.rejectPending(new DatabaseClientError('database', 'データベースWorkerが停止しました。'));
    });
  }

  initialize(): Promise<number> {
    const requestId = this.allocateRequestId();
    return fetchMetadataTotal().then((total) =>
      this.send({ type: 'initialize', requestId, databaseUrl: databaseUrl(), total }).then((response) => {
        if (response.type === 'error') responseError(response);
        if (response.type !== 'initialized') {
          throw protocolError('データベース初期化の応答が不正です。');
        }
        return response.total;
      }),
    );
  }

  search(query: string, page: number): SearchRequest {
    const requestId = this.allocateRequestId();
    const promise = this.send({ type: 'search', requestId, query, page }).then((response) => {
      if (response.type === 'error') responseError(response);
      if (response.type !== 'search-result') {
        throw protocolError('検索結果の応答が不正です。');
      }
      return response.result;
    });
    return { requestId, promise };
  }

  count(): Promise<number> {
    const requestId = this.allocateRequestId();
    return this.send({ type: 'count', requestId }).then((response) => {
      if (response.type === 'error') responseError(response);
      if (response.type !== 'count-result') {
        throw protocolError('件数の応答が不正です。');
      }
      return response.total;
    });
  }

  getRecord(id: string): Promise<CatalogRecord | null> {
    const requestId = this.allocateRequestId();
    return this.send({ type: 'get-record', requestId, id }).then((response) => {
      if (response.type === 'error') responseError(response);
      if (response.type !== 'record-result') {
        throw protocolError('詳細情報の応答が不正です。');
      }
      return response.record;
    });
  }

  dispose(): void {
    this.rejectPending(new DatabaseClientError('database', 'データベースWorkerを終了しました。'));
    this.worker.terminate();
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    if (this.pending.has(requestId)) {
      throw new DatabaseClientError('protocol', 'データベース要求IDが枯渇しました。');
    }
    this.nextRequestId = requestId === Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
    return requestId;
  }

  private send(request: DatabaseWorkerRequest): Promise<DatabaseWorkerResponse> {
    return new Promise<DatabaseWorkerResponse>((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      try {
        this.worker.postMessage(request);
      } catch (error: unknown) {
        this.pending.delete(request.requestId);
        reject(
          new DatabaseClientError(
            'database',
            error instanceof Error ? error.message : 'データベース要求を送信できません。',
          ),
        );
      }
    });
  }

  private handleMessage(value: unknown): void {
    if (!isDatabaseWorkerResponse(value)) {
      this.rejectPending(protocolError('データベースWorkerの応答形式が不正です。'));
      return;
    }

    const pending = this.pending.get(value.requestId);
    if (pending === undefined) return;
    this.pending.delete(value.requestId);
    pending.resolve(value);
  }

  private rejectPending(error: DatabaseClientError): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
