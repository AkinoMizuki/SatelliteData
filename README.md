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
[JPL Horizons API]から取得した探査機の太陽中心・J2000黄道座標の位置速度ベクトルを、JSON形式で返します。

現在はHAYABUSA2、James Webb Space Telescope（JWST）、Tesla Roadsterを取得します。

[JPL Horizons API]: https://ssd-api.jpl.nasa.gov/doc/horizons.html

### データ確認用 URL
https://akinomizuki.github.io/SatelliteData/spacecraft.json

### 更新範囲
GitHub Actions実行日のUTC日付から8日後までを、1時間間隔で取得します。

`spacecraft.yaml`に登録するURLには、`START_TIME`と`STOP_TIME`を記述しません。ビルド時に次の日時が自動的に追加されます。

- `START_TIME`: GitHub Actions実行日のUTC日付
- `STOP_TIME`: 実行日の8日後

### 出力形式
`spacecraft.json`の各サンプルは、次の順序です。

```text
[jdTdb, x, y, z, vx, vy, vz]
```

現在の探査機設定では、位置の単位はAU、速度の単位はAU/日です。

### 取得対象の探査機の変更
YAML形式で記述された [spacecraft.yaml] に、`id`、`name`、Horizons APIの`url`を追加します。

```yaml
- id: HAYABUSA2
  name: HAYABUSA2
  url: "https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND=%27-37%27&..."
```

URLには`START_TIME`と`STOP_TIME`を含めません。通常は既存設定を複製し、`id`、`name`、URL内の`COMMAND`を対象探査機へ変更します。

※masterブランチへのpush権限が必要。

[spacecraft.yaml]: ./spacecraft.yaml
