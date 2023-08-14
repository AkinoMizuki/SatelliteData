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

### URL
https://akinomizuki.github.io/cosmorium-external-data/satellites.txt

### 更新頻度
[毎時12分ごろに更新。 (1時間に1回更新)](./.github/workflows/build-and-deploy.yaml#L2-L4)

### 実行ログ
https://github.com/AkinoMizuki/cosmorium-external-data/actions/workflows/build-and-deploy.yaml

### 取得対象の衛星の変更
YAML形式の配列で記述された [satellites.yaml] を書き替えます。

※masterブランチへのpush権限が必要。

[satellites.yaml]: ./satellites.yaml
