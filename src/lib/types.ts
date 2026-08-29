export const PAGE_SIZE = 50 as const;
export const MAX_PAGE = 1_000_000 as const;
export const MAX_SEARCH_QUERY_LENGTH = 200 as const;
export const MAX_RECORD_ID_LENGTH = 200 as const;
export const MAX_IMAGE_POSITION = 56 as const;
export const DATABASE_APPLICATION_ID = 0x4d45494a as const;
export const DATABASE_USER_VERSION = 1 as const;
export const DATABASE_METADATA_VERSION = 1 as const;

export type NullableString = string | null;

export interface RecordImage {
  position: number;
  url: string;
}

export interface CatalogRecord {
  id: string;
  cardType: NullableString;
  holdingInstitution: NullableString;
  shelfmark: NullableString;
  workTitle: NullableString;
  author: NullableString;
  editionType: NullableString;
  editionDate: NullableString;
  volumeQuantity: NullableString;
  survival: NullableString;
  dimensions: NullableString;
  bookFormat: NullableString;
  frameRuling: NullableString;
  cover: NullableString;
  bindingPaper: NullableString;
  condition: NullableString;
  container: NullableString;
  ownershipMarks: NullableString;
  prefaceColophon: NullableString;
  pictureDescription: NullableString;
  inscriptionDescription: NullableString;
  supplement: NullableString;
  imageTitle: NullableString;
  bibliographicStructure: NullableString;
  images: RecordImage[];
}

export interface SearchResult {
  id: string;
  workTitle: NullableString;
  holdingInstitution: NullableString;
  author: NullableString;
  editionDate: NullableString;
  firstImageUrl: NullableString;
}

export interface SearchPage {
  query: string;
  page: number;
  pageSize: typeof PAGE_SIZE;
  total: number;
  records: SearchResult[];
}

export type DatabaseErrorPhase = 'database' | 'wasm' | 'query';

export type DatabaseWorkerRequest =
  | {
      type: 'initialize';
      requestId: number;
      databaseUrl: string;
      total: number;
    }
  | {
      type: 'search';
      requestId: number;
      query: string;
      page: number;
    }
  | {
      type: 'count';
      requestId: number;
    }
  | {
      type: 'get-record';
      requestId: number;
      id: string;
    };

export type DatabaseWorkerResponse =
  | {
      type: 'initialized';
      requestId: number;
      total: number;
    }
  | {
      type: 'search-result';
      requestId: number;
      result: SearchPage;
    }
  | {
      type: 'count-result';
      requestId: number;
      total: number;
    }
  | {
      type: 'record-result';
      requestId: number;
      record: CatalogRecord | null;
    }
  | {
      type: 'error';
      requestId: number;
      phase: DatabaseErrorPhase;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is NullableString {
  return value === null || typeof value === 'string';
}

function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_RECORD_ID_LENGTH;
}

function isImagePosition(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_IMAGE_POSITION
  );
}

function isRecordImage(value: unknown): value is RecordImage {
  if (!isRecord(value)) return false;
  return isImagePosition(value.position) && typeof value.url === 'string' && value.url.length > 0;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isPage(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_PAGE
  );
}

function isCatalogRecord(value: unknown): value is CatalogRecord {
  if (!isRecord(value) || !isRecordId(value.id) || !Array.isArray(value.images)) return false;

  return (
    isNullableString(value.cardType) &&
    isNullableString(value.holdingInstitution) &&
    isNullableString(value.shelfmark) &&
    isNullableString(value.workTitle) &&
    isNullableString(value.author) &&
    isNullableString(value.editionType) &&
    isNullableString(value.editionDate) &&
    isNullableString(value.volumeQuantity) &&
    isNullableString(value.survival) &&
    isNullableString(value.dimensions) &&
    isNullableString(value.bookFormat) &&
    isNullableString(value.frameRuling) &&
    isNullableString(value.cover) &&
    isNullableString(value.bindingPaper) &&
    isNullableString(value.condition) &&
    isNullableString(value.container) &&
    isNullableString(value.ownershipMarks) &&
    isNullableString(value.prefaceColophon) &&
    isNullableString(value.pictureDescription) &&
    isNullableString(value.inscriptionDescription) &&
    isNullableString(value.supplement) &&
    isNullableString(value.imageTitle) &&
    isNullableString(value.bibliographicStructure) &&
    value.images.every(isRecordImage)
  );
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!isRecord(value)) return false;

  return (
    isRecordId(value.id) &&
    isNullableString(value.workTitle) &&
    isNullableString(value.holdingInstitution) &&
    isNullableString(value.author) &&
    isNullableString(value.editionDate) &&
    isNullableString(value.firstImageUrl)
  );
}

export function isSearchPage(value: unknown): value is SearchPage {
  if (!isRecord(value) || !Array.isArray(value.records)) return false;

  return (
    typeof value.query === 'string' &&
    isPage(value.page) &&
    value.pageSize === PAGE_SIZE &&
    typeof value.total === 'number' &&
    Number.isSafeInteger(value.total) &&
    value.total >= 0 &&
    value.records.every(isSearchResult)
  );
}

export function isDatabaseWorkerRequest(value: unknown): value is DatabaseWorkerRequest {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'initialize':
      return (
        typeof value.databaseUrl === 'string' &&
        value.databaseUrl.length > 0 &&
        value.databaseUrl.length <= 2_048 &&
        typeof value.total === 'number' &&
        Number.isSafeInteger(value.total) &&
        value.total >= 0
      );
    case 'search':
      return (
        typeof value.query === 'string' &&
        value.query.length <= MAX_SEARCH_QUERY_LENGTH &&
        isPage(value.page)
      );
    case 'count':
      return true;
    case 'get-record':
      return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= MAX_RECORD_ID_LENGTH;
    default:
      return false;
  }
}

export function isDatabaseWorkerResponse(value: unknown): value is DatabaseWorkerResponse {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'initialized':
      return typeof value.total === 'number' && Number.isSafeInteger(value.total) && value.total >= 0;
    case 'search-result':
      return isSearchPage(value.result);
    case 'count-result':
      return typeof value.total === 'number' && Number.isSafeInteger(value.total) && value.total >= 0;
    case 'record-result':
      return value.record === null || isCatalogRecord(value.record);
    case 'error':
      return (
        (value.phase === 'database' || value.phase === 'wasm' || value.phase === 'query') &&
        typeof value.message === 'string' &&
        value.message.length > 0
      );
    default:
      return false;
  }
}
