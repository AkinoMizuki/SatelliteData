概要
====
[コスモリウム]の展示で、[Text Loading]などのデータ外部取得で利用するGitHub Pages用リポジトリです。

[コスモリウム]: https://virtualspaceprogram.org/information/2022-10-14-COSMORIUMannounce "『VR宇宙博物館 コスモリウム』は、「人はなぜ宇宙に惹かれるのか？」を基本テーマに、VRならではの展示を経てその自らの答えを探すワールドです。"
[Text Loading]: https://creators.vrchat.com/worlds/udon/string-loading/ "String Loading allows you to download text files from the internet and use them in your VRChat world."

リポジトリの公開状態について
============================
GitHub Pagesを利用するため、**このリポジトリはpublicになっており、誰でも閲覧できます。**

現在の対象コンテンツ
====================
衛星地球儀から取得されるデータ
------------------------------
[CelesTrakのAPI]から取得した展示対象の衛星の軌道データを、[TLE形式]で返します。

Text Loading用です。

[CelesTrakのAPI]: https://celestrak.org/NORAD/documentation/gp-data-formats.php
[TLE形式]: https://ja.wikipedia.org/wiki/2%E8%A1%8C%E8%BB%8C%E9%81%93%E8%A6%81%E7%B4%A0%E5%BD%A2%E5%BC%8F "2行軌道要素形式は、アメリカ航空宇宙局 (NASA) と北アメリカ航空宇宙防衛司令部 (NORAD) が現在でも使用している、人工衛星の地心座標系におけるケプラー軌道要素のテキスト形式のフォーマットである。"

### データ確認用 URL
https://akinomizuki.github.io/SatelliteData/satellites.txt

https://akinomizuki.github.io/SatelliteData/satellites.png

### 更新頻度
[毎時12分ごろに更新。 (1時間に1回更新)](./.github/workflows/build-and-deploy.yaml#L2-L4)

### 実行ログ
https://github.com/AkinoMizuki/SatelliteData/actions/workflows/build-and-deploy.yaml

### 取得対象の衛星の変更
YAML形式の配列で記述された [satellites.yaml] を書き替えます。

※masterブランチへのpush権限が必要。

[satellites.yaml]: ./satellites.yaml

探査機リアルタイムトラッキング用データ
--------------------------------------
[JPL Horizons Lookup API]で探査機名からSPK IDを自動解決し、[JPL Horizons API]から太陽中心・J2000黄道座標の位置速度ベクトルを取得してJSON形式で返します。

現在はHAYABUSA2、James Webb Space Telescope（JWST）、Tesla Roadsterを取得します。

[JPL Horizons Lookup API]: https://ssd-api.jpl.nasa.gov/doc/horizons_lookup.html
[JPL Horizons API]: https://ssd-api.jpl.nasa.gov/doc/horizons.html

### データ確認用 URL
https://akinomizuki.github.io/SatelliteData/spacecraft.json

### 更新範囲
GitHub Actions実行日のUTC日付から8日後までを、1時間間隔で取得します。

日時、API URL、座標系、単位は`fetch-data.js`側で自動設定します。通常の対象ではSPK IDもHorizons Lookupから自動解決します。

### 出力形式
`spacecraft.json`の各サンプルは、次の順序です。

```text
[jdTdb, x, y, z, vx, vy, vz]
```

位置の単位はAU、速度の単位はAU/日です。

### 取得対象の探査機の変更
[spacecraft.yaml]へ、次の形式で1行追加します。

```yaml
出力用ID: JPL Horizonsで検索する探査機名
```

現在の登録内容は次のとおりです。

```yaml
HAYABUSA2: Hayabusa 2
JWST: JWST

# Lookupで検索できない対象のみnameとcommandを指定
TESLA_ROADSTER:
  name: Tesla Roadster
  command: "-143205"
```

例えばVoyager 1を追加する場合は、通常どおり次の1行だけを追加します。

```yaml
VOYAGER1: Voyager 1
```

Horizons Lookupで検索できない対象だけ、`name`と`command`を指定します。対象固有のIDは`fetch-data.js`へベタ書きせず、登録情報を`spacecraft.yaml`へ集約します。

### 通信節約と前回データの継続使用
GitHub Actionsは、最初に公開済みの`spacecraft.json`を1回読み込みます。

同じUTC日付のデータが既に公開されている探査機は、そのデータをそのまま再利用し、Horizons Lookup APIとHorizons APIへの通信を行いません。このため、GitHub Actions自体は毎時実行されても、探査機データのJPL通信は原則としてUTC日付が変わった最初の実行時だけです。

UTC日付が変わった場合も、前回データに保存されている`command`（SPK ID）を再利用できる対象はHorizons Lookup APIを省略し、状態ベクトル取得だけを行います。

JPL APIへの通信は、通信例外またはHTTP 408/425/429/500/502/503/504の場合に最大5回試行します（初回＋再試行4回）。再試行間隔は2秒、5秒、15秒、30秒です。

新しい状態ベクトルを取得できなかった場合は、該当する探査機について公開済みの前回データを`spacecraft.json`へ残します。前回データを使用した対象IDは、トップレベルの`staleObjectIds`へ記録されます。前回データも存在しない場合だけ、その探査機をスキップします。エラー内容と前回データ使用の有無はGitHub Actionsのログへ記録されます。

公開済み`spacecraft.json`を取得できなかった場合は、前回データなしとして通常のJPL取得を試行します。

`spacecraft.yaml`自体がYAMLとして不正、またはルート形式が異なる場合は、設定ファイル全体の誤りとしてビルドを停止します。

※masterブランチへのpush権限が必要。

[spacecraft.yaml]: ./spacecraft.yaml
