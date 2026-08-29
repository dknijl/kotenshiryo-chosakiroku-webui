<script lang="ts">
  import { MAX_SEARCH_QUERY_LENGTH } from '../types.js';

  export let query = '';
  export let busy = false;
  export let onSearch: (query: string) => void = () => undefined;

  let value = query;
  let syncedQuery = query;

  // Follow committed route changes without overwriting an in-progress local edit.
  $: if (query !== syncedQuery) {
    syncedQuery = query;
    value = query;
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    onSearch(value);
  }

  function clear(): void {
    value = '';
    onSearch('');
  }
</script>

<form class="search-form" aria-label="資料を検索" aria-busy={busy} onsubmit={submit}>
  <label for="catalog-search">キーワード</label>
  <div class="search-controls">
    <input
      id="catalog-search"
      name="q"
      type="search"
      bind:value
      maxlength={MAX_SEARCH_QUERY_LENGTH}
      autocomplete="off"
      placeholder="作品名、所蔵者名、編著者名など"
      aria-describedby="search-help"
    />
    <button class="button button-primary" type="submit" disabled={busy}>
      {busy ? '検索中…' : '検索'}
    </button>
    <button class="button button-quiet" type="button" disabled={busy || value === ''} onclick={clear}>
      クリア
    </button>
  </div>
  <p id="search-help" class="form-help">空欄で全件を表示。複数の語はすべて含む記録を検索します。</p>
</form>
