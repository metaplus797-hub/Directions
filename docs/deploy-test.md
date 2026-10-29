# 公開テスト（deploy-test ブランチ）

Vercel・Cloudflare のアカウント登録や課金をしていない状態で、確認できるところまで公開の準備とテストをする。
構成は [publishing-guide.html](publishing-guide.html) のとおり（Vercel + Cloudflare、Vercel の Root Directory は `fastapi-project`）。

## このブランチでの変更

| 変更 | 理由 |
|---|---|
| `frontend/` を `fastapi-project/frontend/` に移動 | Vercel の Root Directory（`fastapi-project`）の外にあるファイルは配置されないため |
| `CORSMiddleware` を削除 | 画面とAPIを同じオリジンから配信するので不要。アプリ全体にミドルウェアがあると、Vercel が静的ファイルをCDNに載せなくなる |
| 公開モード（読み取り専用）を追加 | `VERCEL=1`（Vercel が自動で設定）か `DIRECTIONS_READ_ONLY=1` のとき、編集API 3本（CSV保存・フロア情報保存・背景画像アップロード）を 403 にする。編集APIにはログインがなく、公開すると誰でもデータを書き換えられるため。Vercel ではファイルを保存できないという理由もある |
| `?loc=` に対応（`app.js`） | `https://<ドメイン>/?loc=F7-3` で開くと F7-3 を現在地にする。URLを書いたNFCタグなら iPhone でもかざすだけで開ける。Web NFC で同じ形式のURLを読んだ場合も同じ |
| テスト（pytest）と GitHub Actions を追加 | 下の「1. 自動テスト」 |

`frontend` というフォルダ名は変えていない。Vercel では `public/` も特別なフォルダだが、`public/` は FastAPI でマウントしてはいけない決まりがある。`frontend/` をマウントする今の書き方なら、ローカルと Vercel が同じコードで動き、Vercel はビルド時にこれを検出してCDNから配信する。

## 1. 自動テスト

```
cd fastapi-project
pip install -r requirements-dev.txt
pytest -rxX
```

| ファイル | 確認していること |
|---|---|
| `tests/test_api.py` | 画面から呼ばれるAPI 6本の動作（フロア一覧、地点、目的地、同じフロア内の経路、エレベーター経由の経路、404） |
| `tests/test_deploy.py` | Vercel に載せる条件（`main.py` に `app` がある、アプリ全体のミドルウェアがない、必要なファイルが `fastapi-project` の中にある、画面・地図画像・地点写真が配信される）と、公開モードで編集APIが 403 になりデータが書き換わらないこと |
| `tests/test_data.py` | 地点データ（CSV）の公開前チェック（IDの重複、存在しない地点への接続、文字化け、エレベーターから全目的地に行けるか） |

- `xfail` と表示される2件は、いまのデータに既知の問題があって失敗するもの（下の「既知の問題」）。データを直すと `XPASS` になるので、そのときは `tests/test_data.py` の `@pytest.mark.xfail` を外す。
- GitHub Actions（`.github/workflows/test.yml`）で、push と Pull Request のたびに同じテストが Python 3.12（Vercel の既定）で走る。結果は GitHub の Actions タブで見られる。GitHub 以外のアカウントはいらない。

## 2. 公開モードでローカル起動

PowerShell:

```
cd fastapi-project
$env:DIRECTIONS_READ_ONLY = "1"
uvicorn main:app --port 8000
```

macOS / Linux: `DIRECTIONS_READ_ONLY=1 uvicorn main:app --port 8000`

確認すること:

- http://localhost:8000/?loc=F7-3 を開くと「現在地: W705」になり、フロアが F7 に切り替わる
- 「CSV編集」で保存すると「保存エラー: 公開環境ではデータを編集できません」と出る

## 3. スマホ実機テスト（Cloudflare Quick Tunnel、アカウント不要）

Cloudflare の Quick Tunnel を使うと、手元のサーバーに `https://xxxx.trycloudflare.com` という一時的なURLが付く。HTTPS なので、スマホから Web NFC も含めて試せる。

インストール:

- Windows: `winget install --id Cloudflare.cloudflared`
- macOS: `brew install cloudflared`

手順2のサーバーを起動したまま、別のターミナルで:

```
cloudflared tunnel --url http://localhost:8000
```

表示された `https://xxxx.trycloudflare.com` をスマホで開く。

注意:

- そのURLを知っていれば誰でもアクセスできる。**必ず `DIRECTIONS_READ_ONLY=1` で起動したサーバーに対して使い**、終わったら両方とも Ctrl+C で止める。
- URLは起動するたびに変わる。NFCタグに書き込むのはテスト用と割り切り、本番のドメインが決まったら書き直す。
- 同時に処理できるのは200リクエストまでで、稼働の保証もない。テスト専用。

NFCタグへの書き込みは「NFC Tools」などのアプリで、レコードの種類に「URL」を選んで `https://xxxx.trycloudflare.com/?loc=F7-3` を書き込む。

確認項目:

- [ ] `https://xxxx.trycloudflare.com/?loc=F7-3` を開くと現在地が W705 になる（タグがなければQRコードで代用できる）
- [ ] タグに iPhone をかざすと通知が出て、ブラウザで開ける
- [ ] Android でタグをかざすと開ける
- [ ] Android の Chrome でページを開いたまま別のタグをかざすと、現在地が切り替わる（Web NFC）。動かない場合は、ページを開いた直後に `scan()` を呼んでいて、ユーザー操作がないために許可が取れていない可能性がある
- [ ] 経路表示・フロア切り替え・写真の吹き出しが、スマホの画面で操作できる
- [ ] 「CSV編集」「マップ編集」で保存が拒否される

## 4. アカウントがないと確認できないこと

- Vercel 上で実際に動くか（FastAPI の自動検出、`frontend/` のCDN配信、`from data import ...` のような同じフォルダ内の読み込み）
- 本番URLと確認用（プレビュー）URLの発行
- 独自ドメインと DNS（Cloudflare）

アカウントを作ったら、[publishing-guide.html](publishing-guide.html) の「最初の1回だけ」の手順で進める。Vercel では `VERCEL=1` が自動で設定されるので、編集APIは何もしなくても止まる。念のため、Vercel の環境変数に `DIRECTIONS_READ_ONLY=1` も設定しておくとよい。

## 既知の問題（公開前に直す）

- 屋外の地点名が文字化けしている（out-1〜4, out-11）。元データから名前を取り直す必要がある
- 屋外の通路が一方通行で、建物から out-3〜out-11 に行けない
- 編集画面で追加されたと思われる行 `test,test,0,0,6,TRUE,F6` が残っている
- 公開モードでも画面に「CSV編集」「マップ編集」のリンクが出る（押しても保存はできない）
- `index.html` が `class="appa"`、`style.css` が `.app` で、地図が画面の高さいっぱいに広がらない
- 背景画像アップロード（`POST /api/floors/{floor}/map-image`）は、フロア名をそのまま保存先のファイル名に使っている。Windows では `..\` を含むフロア名で、images フォルダの外に任意の拡張子のファイルを書き込める。公開モードでは 403 で止まるが、フロア名と拡張子のチェックを入れるべき
