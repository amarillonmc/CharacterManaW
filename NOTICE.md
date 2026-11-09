# NOTICE / 致谢与许可

## 原作

- 软件：**キャラクターなんとか機** / Character Nantoka Ki, version 3.07
- 作者：**緋龍華 麒麟** / K.Hmix 1st Edition
- 原站：http://khmix.sakura.ne.jp/
- 原作说明：`data/default/readme.txt`（Shift-JIS）

原作说明允许自由使用输出图片、修改和再分发同梱的 default 素材；使用非 default 素材时须遵守素材作者的条件。本移植版只内置 `data/default`，未内置原目录中的其他模板/素材。

## Web 移植版

- 代码：MIT License（见 `LICENSE`）
- 实现：Node.js + Express + pngjs + sharp，浏览器前端为原生 ES Modules。
- 本项目不是原作作者的官方版本，与原作作者无隶属关系。

## 兼容性研究参考

- **CharacterManaJ** by seraphy (Apache License 2.0)
  - https://charactermanaj.sourceforge.io/
  - 公开文档用于理解「キャラクターなんとか機」的图层、目录、.cpd 兼容约定。本移植版为独立实现，未包含 CharacterManaJ 的源代码。
- 原作二进制仅用于行为/像素对照验证，未随交付物分发。

## 第三方依赖

| Package | License |
| --- | --- |
| express | MIT |
| archiver | MIT |
| iconv-lite | MIT |
| multer | MIT |
| pngjs | MIT |
| sharp | Apache-2.0 |

完整依赖树及其许可证以 `node_modules` 中各包附带的 LICENSE 文件为准。
