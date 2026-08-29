import type { CatalogRecord } from './types.js';

const BREAK_TAG = /<br\s*\/?>/giu;

export function normalizeSearchText(value: string): string {
  return value.replace(BREAK_TAG, '\n').normalize('NFKC');
}

export function splitSearchTerms(query: string): string[] {
  return normalizeSearchText(query)
    .trim()
    .split(/\s+/u)
    .filter((term) => term.length > 0);
}

export function isTrigramSearchTerm(term: string): boolean {
  return Array.from(term).length >= 3 && !term.includes('\u0000');
}

export function toFtsPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

export interface SearchWhere {
  where: string;
  bind: string[];
}

export function buildSearchWhere(query: string): SearchWhere {
  const terms = splitSearchTerms(query);
  const conditions: string[] = [];
  const bind: string[] = [];

  for (const term of terms) {
    if (isTrigramSearchTerm(term)) {
      conditions.push(
        'r.id IN (SELECT f.id FROM records_fts AS f WHERE records_fts MATCH ?)',
      );
      bind.push(toFtsPhrase(term));
    } else {
      conditions.push('instr(r.search_text, ?) > 0');
      bind.push(normalizeSearchText(term));
    }
  }

  return {
    where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`,
    bind,
  };
}

export function buildSearchText(record: CatalogRecord): string {
  const fields: Array<string | null> = [
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
  ];

  return normalizeSearchText(
    fields
      .filter((field): field is string => field !== null)
      .join('\n'),
  );
}

export function toDisplayText(value: string | null): string {
  return value === null ? '' : value.replace(BREAK_TAG, '\n');
}

export function toTitleText(value: string | null): string {
  return value === null ? '' : value.replace(BREAK_TAG, ' ');
}

export function makeExcerpt(value: string, maxLength = 220): string {
  const text = toDisplayText(value).replace(/\s+/gu, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${Array.from(text).slice(0, maxLength).join('')}…`;
}
