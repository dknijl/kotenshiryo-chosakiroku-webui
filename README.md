# 日本古典資料調査記録データベース WEB UI

国文学研究資料館の日本古典資料調査記録データベースを検索・閲覧するサイトです。
サーバー側のAPI、検索処理、書き込み可能なデータベースは使用しません。

## 必要な環境

- Node.js 22以上
- npm

## セットアップ

```sh
npm install
```

## 開発

```sh
npm run dev
```

表示される：

  ➜  Local:   http://localhost:5173/

のURL http://localhost:5173/ にアクセスしてください。

ブラウザ内のWorkerが`public/data/kotenkiroku.sqlite`を読み込むため、Viteの開発サーバー経由で確認してください。

## CSVの差し替え

入力CSVのヘッダーは`sample.csv`と同じ80列を、同じ順序で指定してください。内訳は調査カード整理番号を含む書誌情報24列と、`画像1`から`画像56`までの画像列56列です。既定値はリポジトリ直下の`sample.csv`です。

環境変数で指定する場合:

```sh
KOTENKIROKU_CSV=/path/to/kotenkiroku.csv npm run build
```

データベース生成だけを別の入力で実行する場合:

```sh
npm run db:build -- --input /path/to/new-catalog.csv
```

国文研で公開している元データで実施する場合は下記の手順でDBが作成可能です。

```bash
gzip -d koten.csv.gz
KOTENKIROKU_CSV=./koten.csv npm run build
```

出力先を指定する場合は`--output`を追加できます。CSVの壊れた引用符、列数・ヘッダーの不一致、空の調査カード整理番号、長すぎる値、重複IDは行番号付きでエラーになり、不正な画像URL（`http`/`https`かつ`.jpg`以外）も行番号付きでエラーになります。エラー時は既存のSQLiteファイルを置き換えません。

## 検証とビルド

```sh
npm run check
npm run test
npm run build
```

`npm run build`は次の順で実行します。

1. CSVから一時SQLiteファイルを生成する。
2. `metadata`、`records`、`record_images`、`records_fts`（FTS5`trigram`インデックス）、`integrity_check`、`foreign_key_check`、件数、メタデータ名、画像番号範囲を検証する。
3. 検証済みのSQLiteと件数metadataを`public/data/kotenkiroku.sqlite`、`public/data/kotenkiroku-meta.json`へ原子的に置き換える。
4. Viteで`dist/`を生成する。

`dist/`には`index.html`、JavaScript、CSS、SQLite WASM、SQLiteデータベース、件数metadataが含まれます。

## Netlify

Netlifyでデプロイする場合は、リポジトリ直下の`netlify.toml`を使用してください。SQLiteファイルはHTTP Range読み込みのため、圧縮せずバイト単位で配信する設定になっています。

## SFTPなどでWEBサイトに配置する場合

`dist/`の中身をSFTPで任意のサブディレクトリへアップロードしてください。Viteの`base`は`./`で、ルーティングはハッシュ形式のため、サーバー側のURLリライトやAPI設定は必要ありません。静的サーバーが`.wasm`を配信できるようにしてください。

画面のURLは次の形式です。

- 検索: `#/search?q=検索語&page=1`
- 詳細: `#/records/調査カード整理番号?q=検索語&page=1`

詳細画面の戻るリンクには、検索語とページ番号が保持されます。

## データ出典

国文学研究資料館 日本古典資料調査記録データベースが提供する調査カードデータを使用しています。元データは[日本古典資料調査記録データベースのデータセット](https://kokubunken.repo.nii.ac.jp/records/4733)です。

画像URLは入力CSVの`画像1`〜`画像56`列の値をそのまま使用します。HTTPまたはHTTPSの`.jpg`だけを画像として描画し、その他の値は表示せず入力エラーとして扱います。HTTPSサイトでHTTP画像をHTTPSへ自動変換したり、プロキシしたりはしません。

## LICENSE

このソースコードはMITライセンスです。データの取り扱いについては提供元の利用条件に従ってください。

