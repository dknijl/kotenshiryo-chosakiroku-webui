import { MAX_PAGE, MAX_SEARCH_QUERY_LENGTH } from './types.js';

export type SearchRoute = {
  name: 'search';
  query: string;
  page: number;
};

export type RecordRoute = {
  name: 'record';
  id: string;
  returnQuery: string;
  returnPage: number;
};

export type NotFoundRoute = {
  name: 'not-found';
};

export type Route = SearchRoute | RecordRoute | NotFoundRoute;

function parsePage(value: string | null): number {
  if (value === null || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

function parseQuery(value: string | null): string {
  return value === null ? '' : Array.from(value).slice(0, MAX_SEARCH_QUERY_LENGTH).join('');
}

function decodeRecordId(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseRoute(hash: string): Route {
  const routeText = hash.startsWith('#') ? hash.slice(1) : hash;
  const route = new URL(routeText || '/search', 'https://catalog.invalid');
  const query = parseQuery(route.searchParams.get('q'));
  const page = parsePage(route.searchParams.get('page'));

  if (route.pathname === '/search' || route.pathname === '/') {
    return { name: 'search', query, page };
  }

  if (route.pathname.startsWith('/records/')) {
    const encodedId = route.pathname.slice('/records/'.length);
    if (encodedId === '') return { name: 'not-found' };
    const id = decodeRecordId(encodedId);
    if (id === null || id === '') return { name: 'not-found' };
    return {
      name: 'record',
      id,
      returnQuery: query,
      returnPage: page,
    };
  }

  return { name: 'not-found' };
}

export function searchHash(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query !== '') params.set('q', query);
  params.set('page', String(Math.max(1, Math.min(MAX_PAGE, Math.trunc(page)))));
  return `#/search?${params.toString()}`;
}

export function recordHash(id: string, query: string, page: number): string {
  const params = new URLSearchParams();
  if (query !== '') params.set('q', query);
  params.set('page', String(Math.max(1, Math.min(MAX_PAGE, Math.trunc(page)))));
  return `#/records/${encodeURIComponent(id)}?${params.toString()}`;
}
