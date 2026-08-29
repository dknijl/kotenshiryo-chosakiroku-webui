import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDatabaseSource } from '../src/lib/database-http.js';

const databaseUrl = 'http://localhost/data/kotenkiroku.sqlite';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('database HTTP source selection', () => {
  it('keeps the HTTP VFS path for a range response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0x53]), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-0/110592' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDatabaseSource(databaseUrl)).resolves.toEqual({ kind: 'range' });
    expect(fetchMock).toHaveBeenCalledWith(databaseUrl, {
      credentials: 'same-origin',
      headers: { Range: 'bytes=0-0' },
    });
  });

  it('keeps a full response for a server that ignores Range', async () => {
    const bytes = new Uint8Array([0x53, 0x51, 0x4c, 0x69]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { status: 200 })));

    await expect(fetchDatabaseSource(databaseUrl)).resolves.toEqual({ kind: 'bytes', bytes });
  });

  it('rejects HTTP errors and empty full responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(fetchDatabaseSource(databaseUrl)).rejects.toThrow('HTTP 404');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(), { status: 200 })));
    await expect(fetchDatabaseSource(databaseUrl)).rejects.toThrow('SQLiteデータベースが空です');
  });
});
