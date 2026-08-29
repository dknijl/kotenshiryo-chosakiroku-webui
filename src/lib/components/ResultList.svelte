<script lang="ts">
  import { recordHash } from '../router.js';
  import { validateImageUrl, type ImageValidation } from '../images.js';
  import { toTitleText } from '../search.js';
  import type { SearchResult } from '../types.js';

  export let records: SearchResult[] = [];
  export let query = '';
  export let page = 1;

  let failedImages: string[] = [];

  $: failedImages = failedImages.filter((id) => records.some((record) => record.id === id));

  function imageState(value: string | null): ImageValidation {
    return validateImageUrl(value);
  }

  function hasFailedImage(id: string): boolean {
    return failedImages.includes(id);
  }

  function markImageFailed(id: string): void {
    if (!hasFailedImage(id)) failedImages = [...failedImages, id];
  }

  function display(value: string | null): string {
    return value === null || value === '' ? '記録なし' : toTitleText(value);
  }
</script>

<ol class="result-list" aria-label="検索結果">
  {#each records as record (record.id)}
    {@const image = imageState(record.firstImageUrl)}
    <li class="result-item">
      <article class="result-card">
        <div class:result-no-image={image.kind === 'none'} class="result-image-column">
          {#if image.kind === 'valid' && !hasFailedImage(record.id)}
            <img
              class="result-image"
              src={image.url}
              alt={`${display(record.workTitle)}の書影`}
              loading="lazy"
              onerror={() => markImageFailed(record.id)}
            />
          {:else if image.kind === 'invalid'}
            <p class="image-message image-message-error">{image.message}</p>
          {:else if hasFailedImage(record.id)}
            <div class="image-message image-message-error">
              <span>画像を読み込めません。</span>
              {#if record.firstImageUrl}
                <a href={record.firstImageUrl} target="_blank" rel="noreferrer">元画像を開く</a>
              {/if}
            </div>
          {:else}
            <span class="image-unavailable">画像なし</span>
          {/if}
        </div>
        <div class="result-content">
          <h2 class="result-title">
            <a href={recordHash(record.id, query, page)}>{display(record.workTitle) || '（作品名なし）'}</a>
          </h2>
          <p class="result-id">調査カード整理番号: <a href={recordHash(record.id, query, page)}>{record.id}</a></p>
          {#if record.holdingInstitution}
            <p class="result-meta"><span>所蔵者名</span>{record.holdingInstitution}</p>
          {/if}
          {#if record.author}
            <p class="result-meta"><span>編著者名</span>{record.author}</p>
          {/if}
          {#if record.editionDate}
            <p class="result-meta"><span>写刊年次</span>{record.editionDate}</p>
          {/if}
        </div>
      </article>
    </li>
  {/each}
</ol>
