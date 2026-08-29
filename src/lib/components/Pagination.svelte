<script lang="ts">
  import { PAGE_SIZE } from '../types.js';

  export let page = 1;
  export let total = 0;
  export let busy = false;
  export let onNavigate: (page: number) => void = () => undefined;

  $: totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  $: pages = pageNumbers(totalPages, page);

  function pageNumbers(totalPageCount: number, currentPage: number): Array<number | 'ellipsis'> {
    if (totalPageCount <= 7) {
      return Array.from({ length: totalPageCount }, (_, index) => index + 1);
    }

    const values: Array<number | 'ellipsis'> = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPageCount - 1, currentPage + 1);
    if (start > 2) values.push('ellipsis');
    for (let value = start; value <= end; value += 1) values.push(value);
    if (end < totalPageCount - 1) values.push('ellipsis');
    values.push(totalPageCount);
    return values;
  }

  function goTo(nextPage: number): void {
    if (busy || nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    onNavigate(nextPage);
  }
</script>

{#if total > 0}
  <nav class="pagination" aria-label="ページ移動">
    <button class="page-button page-edge" type="button" disabled={busy || page === 1} onclick={() => goTo(1)}>
      先頭
    </button>
    <button class="page-button" type="button" disabled={busy || page === 1} onclick={() => goTo(page - 1)}>
      前へ
    </button>
    <div class="page-numbers" aria-label={`${totalPages}ページ中${page}ページ`}>
      {#each pages as pageValue}
        {#if pageValue === 'ellipsis'}
          <span class="page-ellipsis" aria-hidden="true">…</span>
        {:else}
          <button
            class:page-current={pageValue === page}
            class="page-button"
            type="button"
            aria-current={pageValue === page ? 'page' : undefined}
            disabled={busy}
            onclick={() => goTo(pageValue)}
          >
            {pageValue}
          </button>
        {/if}
      {/each}
    </div>
    <button class="page-button" type="button" disabled={busy || page === totalPages} onclick={() => goTo(page + 1)}>
      次へ
    </button>
    <button class="page-button page-edge" type="button" disabled={busy || page === totalPages} onclick={() => goTo(totalPages)}>
      末尾
    </button>
  </nav>
{/if}
