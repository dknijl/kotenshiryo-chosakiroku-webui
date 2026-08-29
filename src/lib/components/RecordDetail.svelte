<script lang="ts">
  import { searchHash } from '../router.js';
  import { toDisplayText } from '../search.js';
  import { validateImageUrl, type ImageValidation } from '../images.js';
  import type { CatalogRecord, RecordImage } from '../types.js';

  export let record: CatalogRecord;
  export let returnQuery = '';
  export let returnPage = 1;

  let failedImages: number[] = [];

  $: fields = [
    { label: '調査カード整理番号', value: record.id },
    { label: 'カード種別', value: record.cardType },
    { label: '所蔵者名', value: record.holdingInstitution },
    { label: '整理番号', value: record.shelfmark },
    { label: '作品名', value: record.workTitle },
    { label: '編著者名', value: record.author },
    { label: '写刊', value: record.editionType },
    { label: '写刊年次', value: record.editionDate },
    { label: '巻数・数量', value: record.volumeQuantity },
    { label: '残存', value: record.survival },
    { label: '寸法', value: record.dimensions },
    { label: '書型', value: record.bookFormat },
    { label: '匡郭・界罫等', value: record.frameRuling },
    { label: '表紙', value: record.cover },
    { label: '装訂／料紙', value: record.bindingPaper },
    { label: '保存状況', value: record.condition },
    { label: '箱・帙・袋・包紙', value: record.container },
    { label: '蔵書印等', value: record.ownershipMarks },
    { label: '序・跋・刊記・奥書等', value: record.prefaceColophon },
    { label: '絵：記述', value: record.pictureDescription },
    { label: '書入：記述', value: record.inscriptionDescription },
    { label: '補記：記述', value: record.supplement },
    { label: '書影タイトル', value: record.imageTitle },
    { label: '書誌構成', value: record.bibliographicStructure },
  ];

  function imageState(value: string | null): ImageValidation {
    return validateImageUrl(value);
  }

  function hasFailedImage(position: number): boolean {
    return failedImages.includes(position);
  }

  function markImageFailed(position: number): void {
    if (!hasFailedImage(position)) failedImages = [...failedImages, position];
  }

  function displayValue(value: string | null): string {
    return value === null || value === '' ? '記録なし' : value;
  }

  function displayLine(value: string | null): string {
    return toDisplayText(value);
  }

  function lines(value: string | null): string[] {
    return toDisplayText(value).split('\n');
  }

  function titleLines(value: string | null): string[] {
    const text = displayLine(value);
    return text === '' ? [displayValue(value)] : text.split('\n');
  }

  function altText(image: RecordImage): string {
    const title = displayValue(record.workTitle);
    return `${title} 画像${image.position}`;
  }
</script>

<article class="record-detail">
  <a class="back-link" href={searchHash(returnQuery, returnPage)}>← 検索結果へ戻る</a>
  <header class="detail-header">
    <p class="eyebrow">日本古典資料調査記録データベース / RECORD</p>
    <h1>
      {#each titleLines(record.workTitle) as line, index}
        {#if index > 0}<br />{/if}{line}
      {/each}
    </h1>
    {#if record.holdingInstitution}
      <p class="detail-subtitle">{record.holdingInstitution}</p>
    {/if}
  </header>

  {#if record.images.length > 0}
    <section class="detail-image-section" aria-labelledby="detail-images-heading">
      <h2 id="detail-images-heading">書影（{record.images.length}件）</h2>
      <div class="detail-image-grid">
        {#each record.images as image (image.position)}
          {@const validation = imageState(image.url)}
          {#if validation.kind === 'valid' && !hasFailedImage(image.position)}
            <figure class="detail-image-figure">
              <img
                src={validation.url}
                alt={altText(image)}
                loading="lazy"
                onerror={() => markImageFailed(image.position)}
              />
              <figcaption>画像{image.position} <a href={validation.url} target="_blank" rel="noreferrer">元画像を開く</a></figcaption>
            </figure>
          {:else if validation.kind === 'invalid'}
            <figure class="detail-image-figure detail-image-item-warning">
              <span class="image-message image-message-error">{validation.message}</span>
              <figcaption>画像{image.position}：{image.url}</figcaption>
            </figure>
          {:else if hasFailedImage(image.position)}
            <figure class="detail-image-figure detail-image-item-warning">
              <span class="image-message image-message-error">画像を読み込めませんでした。</span>
              <figcaption>
                画像{image.position}
                <a href={image.url} target="_blank" rel="noreferrer">元画像を開く</a>
              </figcaption>
            </figure>
          {/if}
        {/each}
      </div>
    </section>
  {:else}
    <section class="detail-image-section detail-image-warning" aria-labelledby="detail-image-warning-heading">
      <h2 id="detail-image-warning-heading">書影</h2>
      <p>画像記録はありません。</p>
    </section>
  {/if}

  <dl class="record-fields">
    {#each fields as field}
      <div class="record-field">
        <dt>{field.label}</dt>
        <dd>
          {#if field.value && ((displayLine(field.value)).includes('\n'))}
            <div class="record-body">
              {#each lines(field.value) as line}
                <span>{line}</span>
                <br />
              {/each}
            </div>
          {:else}
            {displayValue(field.value)}
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
</article>
