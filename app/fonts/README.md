# 網站字型

沿用網站的 Nunito 與 Noto Sans TC，透過 `next/font/local` 自行提供字型，建置與瀏覽時不連線到 Google Fonts。

來源為 [Google Fonts](https://github.com/google/fonts/tree/86aced91de05cd4f96a06838124cca45be337b2b)，固定提交 `86aced91de05cd4f96a06838124cca45be337b2b`：

| 檔案 | 原始字型 | 字重 |
| --- | --- | --- |
| `nunito-variable.woff2` | [`ofl/nunito/Nunito[wght].ttf`](https://github.com/google/fonts/blob/86aced91de05cd4f96a06838124cca45be337b2b/ofl/nunito/Nunito%5Bwght%5D.ttf) | 200–1000 |
| `noto-sans-tc-variable.woff2` | [`ofl/notosanstc/NotoSansTC[wght].ttf`](https://github.com/google/fonts/blob/86aced91de05cd4f96a06838124cca45be337b2b/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf) | 100–900 |

使用 fontTools 的 WOFF2 壓縮，保留原始字形與字重範圍。此轉換只在更新字型時需要，網站安裝與建置不需要 Python。兩份字型均附有原始 SIL Open Font License 1.1 授權（同目錄的 `.OFL.txt`）。更新字型時請同時更新來源版本與授權檔。
