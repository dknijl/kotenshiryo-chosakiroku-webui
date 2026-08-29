<script lang="ts">
  import { onMount } from 'svelte';
  import SearchForm from './lib/components/SearchForm.svelte';
  import ResultList from './lib/components/ResultList.svelte';
  import Pagination from './lib/components/Pagination.svelte';
  import RecordDetail from './lib/components/RecordDetail.svelte';
  import { DatabaseClient, DatabaseClientError } from './lib/database-client.js';
  import { parseRoute, searchHash, type Route } from './lib/router.js';
  import type { CatalogRecord, SearchPage } from './lib/types.js';

  type ViewStatus =
    | 'initializing'
    | 'searching'
    | 'ready'
    | 'empty'
    | 'record-loading'
    | 'record-ready'
    | 'not-found'
    | 'error';
  type ErrorTarget = 'initialize' | 'search' | 'record';

  let route: Route = { name: 'search', query: '', page: 1 };
  let databaseClient: DatabaseClient | null = null;
  let initialized = false;
  let status: ViewStatus = 'initializing';
  let errorTarget: ErrorTarget = 'initialize';
  let errorMessage = '';
  let currentQuery = '';
  let currentPage = 1;
  let searchResult: SearchPage | null = null;
  let record: CatalogRecord | null = null;
  let activeSearchRequestId = 0;
  let activeRecordRequestId = 0;

  onMount(() => {
    route = parseRoute(window.location.hash);
    const client = new DatabaseClient();
    databaseClient = client;

    function onHashChange(): void {
      const nextRoute = parseRoute(window.location.hash);
      route = nextRoute;
      handleRoute(nextRoute);
    }

    window.addEventListener('hashchange', onHashChange);
    initialize(client);

    return () => {
      window.removeEventListener('hashchange', onHashChange);
      client.dispose();
      databaseClient = null;
    };
  });

  function initialize(client: DatabaseClient): void {
    status = 'initializing';
    errorTarget = 'initialize';
    errorMessage = '';
    client
      .initialize()
      .then(() => {
        initialized = true;
        handleRoute(route);
      })
      .catch((error: unknown) => {
        status = 'error';
        errorTarget = 'initialize';
        errorMessage = friendlyError(error);
      });
  }

  function handleRoute(nextRoute: Route): void {
    activeSearchRequestId = 0;
    activeRecordRequestId = 0;
    errorMessage = '';

    if (!initialized || databaseClient === null) return;

    if (nextRoute.name === 'search') {
      currentQuery = nextRoute.query;
      currentPage = nextRoute.page;
      record = null;
      searchResult = null;
      status = 'searching';
      const request = databaseClient.search(nextRoute.query, nextRoute.page);
      activeSearchRequestId = request.requestId;
      request.promise
        .then((result) => {
          if (!isCurrentSearch(request.requestId, nextRoute.query, nextRoute.page)) return;
          const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
          if (result.total > 0 && nextRoute.page > lastPage) {
            navigate(searchHash(nextRoute.query, lastPage));
            return;
           }
           searchResult = result;
           status = result.total === 0 ? 'empty' : 'ready';
        })
        .catch((error: unknown) => {
          if (!isCurrentSearch(request.requestId, nextRoute.query, nextRoute.page)) return;
          status = 'error';
          errorTarget = 'search';
          errorMessage = friendlyError(error);
        });
      return;
    }

    if (nextRoute.name === 'record') {
      record = null;
      searchResult = null;
      status = 'record-loading';
      const requestId = databaseClient.getRecord(nextRoute.id);
      const currentRequestId = ++activeRecordRequestId;
      requestId
        .then((result) => {
          if (!isCurrentRecord(currentRequestId, nextRoute.id)) return;
          record = result;
          status = result === null ? 'not-found' : 'record-ready';
        })
        .catch((error: unknown) => {
          if (!isCurrentRecord(currentRequestId, nextRoute.id)) return;
          status = 'error';
          errorTarget = 'record';
          errorMessage = friendlyError(error);
        });
      return;
    }

    status = 'not-found';
  }

  function isCurrentSearch(requestId: number, query: string, page: number): boolean {
    return (
      activeSearchRequestId === requestId &&
      route.name === 'search' &&
      route.query === query &&
      route.page === page
    );
  }

  function isCurrentRecord(requestId: number, id: string): boolean {
    return activeRecordRequestId === requestId && route.name === 'record' && route.id === id;
  }

  function navigate(hash: string): void {
    if (window.location.hash === hash) {
      const nextRoute = parseRoute(hash);
      route = nextRoute;
      handleRoute(nextRoute);
      return;
    }
    window.location.hash = hash;
  }

  function submitSearch(query: string): void {
    currentQuery = query;
    currentPage = 1;
    status = 'searching';
    navigate(searchHash(query, 1));
  }

  function navigateToPage(page: number): void {
    if (route.name !== 'search') return;
    status = 'searching';
    navigate(searchHash(route.query, page));
  }

  function retry(): void {
    if (databaseClient === null) return;
    if (errorTarget === 'initialize') {
      initialize(databaseClient);
      return;
    }
    handleRoute(route);
  }

  function friendlyError(error: unknown): string {
    const phase = error instanceof DatabaseClientError ? error.phase : 'database';
    if (phase === 'wasm') return '検索エンジンを初期化できませんでした。ページを再読み込みして再試行してください。';
    if (phase === 'query') return '資料データベースの検索に失敗しました。配布データの整合性を確認して再試行してください。';
    if (phase === 'protocol') return 'データベースとの通信形式を確認できませんでした。ページを再読み込みしてください。';
    return '資料データを取得できませんでした。配置場所と接続を確認して再試行してください。';
  }

  function statusText(): string {
    if (status === 'initializing') return 'データベースを準備しています…';
    if (status === 'searching') return '検索しています…';
    if (status === 'empty') return '該当する資料はありません。';
    if (status === 'ready' && searchResult) {
      return `${searchResult.total.toLocaleString('ja-JP')}件中 ${searchResult.page}ページ目`;
    }
    return '';
  }
</script>

<svelte:head>
  <title>{route.name === 'record' && record ? `${record.workTitle || record.id} | 日本古典資料調査記録データベース` : '日本古典資料調査記録データベース'}</title>
</svelte:head>

<div class="site-shell">
  <header class="site-header">
    <a class="brand" href={searchHash('', 1)}>
      <span class="brand-mark" aria-hidden="true">古</span>
      <span>
        <span class="brand-kicker">JAPANESE CLASSICAL MATERIALS</span>
        <span class="brand-name">日本古典資料調査記録</span>
      </span>
    </a>
    <p class="header-note">調査記録データベース。</p>
  </header>

  {#if route.name === 'search'}
    <main class="page-main search-page">
      <SearchForm
        query={currentQuery}
        busy={status === 'initializing' || status === 'searching'}
        onSearch={submitSearch}
      />

      <div class="results-toolbar">
        <p class="status-line" aria-live="polite" aria-atomic="true">{statusText()}</p>
        {#if searchResult && status === 'ready'}
          <p class="page-indicator">{searchResult.page} / {Math.max(1, Math.ceil(searchResult.total / searchResult.pageSize))} PAGE</p>
        {/if}
      </div>

      {#if status === 'initializing'}
        <section class="state-panel state-loading" aria-live="polite" aria-busy="true">
          <span class="loading-line" aria-hidden="true"></span>
          <h2>データベースを準備しています</h2>
          <p>ブラウザ内に検索用データベースを読み込んでいます。</p>
        </section>
      {:else if status === 'error'}
        <section class="state-panel state-error" role="alert">
          <p class="state-label">READING INTERRUPTED</p>
          <h2>データベースを読み込めませんでした</h2>
          <p>{errorMessage}</p>
          <button class="button button-primary" type="button" onclick={retry}>再試行</button>
        </section>
      {:else if status === 'searching'}
        <section class="state-panel state-loading" aria-live="polite" aria-busy="true">
          <span class="loading-line" aria-hidden="true"></span>
          <h2>検索しています</h2>
          <p>該当する資料を探しています。</p>
        </section>
      {:else if status === 'empty'}
        <section class="state-panel state-empty" aria-live="polite">
          <p class="state-label">NO MATCHES</p>
          <h2>見つかりませんでした</h2>
          <p>別の語で検索するか、検索欄を空にして全件を表示してください。</p>
        </section>
      {:else if searchResult}
        <section class="results-region">
          <ResultList records={searchResult.records} query={currentQuery} page={currentPage} />
          <Pagination
            page={searchResult.page}
            total={searchResult.total}
            busy={false}
            onNavigate={navigateToPage}
          />
        </section>
      {/if}
    </main>
  {:else if route.name === 'record' && status === 'record-ready' && record}
    <main class="page-main detail-page">
      <RecordDetail record={record} returnQuery={route.returnQuery} returnPage={route.returnPage} />
    </main>
  {:else if route.name === 'record' && status === 'record-loading'}
    <main class="page-main detail-page">
      <section class="state-panel state-loading" aria-live="polite" aria-busy="true">
        <span class="loading-line" aria-hidden="true"></span>
        <h1>記録を読み込んでいます</h1>
        <p>詳細情報を取得しています。</p>
      </section>
    </main>
  {:else if route.name === 'record' && status === 'error'}
    <main class="page-main detail-page">
      <section class="state-panel state-error" role="alert">
        <p class="state-label">READING INTERRUPTED</p>
        <h1>詳細情報を読み込めませんでした</h1>
        <p>{errorMessage}</p>
        <button class="button button-primary" type="button" onclick={retry}>再試行</button>
      </section>
    </main>
  {:else if route.name === 'record'}
    <main class="page-main detail-page">
      <section class="state-panel state-empty" role="status">
        <p class="state-label">404 / RECORD NOT FOUND</p>
        <h1>記録が見つかりません</h1>
        <p>指定された調査カード整理番号の記録はデータベースにありません。</p>
        <a class="button button-primary button-link" href={searchHash(route.returnQuery, route.returnPage)}>検索結果へ戻る</a>
      </section>
    </main>
  {:else}
    <main class="page-main detail-page">
      <section class="state-panel state-empty" role="status">
        <p class="state-label">404 / PAGE NOT FOUND</p>
        <h1>ページが見つかりません</h1>
        <a class="button button-primary button-link" href={searchHash('', 1)}>検索へ戻る</a>
      </section>
    </main>
  {/if}

  <footer class="site-footer">
    <span>日本古典資料調査記録データベース</span>
    <span>Client-side SQLite / Static archive</span>
  </footer>
</div>
