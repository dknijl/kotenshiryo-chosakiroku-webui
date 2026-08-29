export type DatabaseSource =
  | { kind: 'range' }
  | { kind: 'bytes'; bytes: Uint8Array };

export async function fetchDatabaseSource(url: string): Promise<DatabaseSource> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Range: 'bytes=0-0' },
  });

  if (response.status === 206) {
    await response.arrayBuffer();
    return { kind: 'range' };
  }

  if (response.status !== 200) {
    throw new Error(`SQLiteデータベースを取得できません（HTTP ${response.status}）。`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('SQLiteデータベースが空です。');
  return { kind: 'bytes', bytes };
}
