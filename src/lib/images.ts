export type ImageValidation =
  | { kind: 'none' }
  | { kind: 'valid'; url: string }
  | { kind: 'invalid'; message: string };

export function validateImageUrl(value: string | null): ImageValidation {
  if (value === null || value === '') return { kind: 'none' };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: 'invalid', message: '画像URLの形式が不正です。' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'invalid', message: 'HTTPまたはHTTPSの画像URLだけ表示できます。' };
  }
  if (!url.pathname.toLowerCase().endsWith('.jpg')) {
    return { kind: 'invalid', message: 'JPG画像ではないため表示できません。' };
  }

  return { kind: 'valid', url: value };
}

export function firstValidImageUrl(urls: Array<string | null>): string | null {
  for (const url of urls) {
    const validation = validateImageUrl(url);
    if (validation.kind === 'valid') return validation.url;
  }
  return null;
}
