# 兼容性说明

本文档记录本移植版与「キャラクターなんとか機 Ver 3.07」的文件格式、图层、颜色和输出约定，以及逐像素验证结果。

## 1. character.ini

路径：`data/<模板ID>/character.ini`

- 编码：原作使用 Windows ANSI（日文环境为 CP932/Shift-JIS）。本移植版自动识别 CP932、EUC-JP、UTF-8（含 BOM）、UTF-16LE/BE（含 BOM）。
- 段落/键大小写不敏感。
- `[Size]`
  - `size_x`, `size_y`：画布尺寸（默认 300×400）。
- `[Parts]`
  - `hair_front`, `hair_back`, `head`, `face`, `eye`, `body`：初始部件名（不含扩展名）。
  - `accessory`：半角逗号分隔的初始饰品名。
  - `face` 对应 `face_front` 列表；`body` 对应 `body_back` 列表。
- `[Color]`
  - `hair_rgb`, `hair_gray`, `eye_rgb`, `eye_gray`, `skin_rgb`, `skin_gray`, `body_rgb`, `body_gray`。
  - `custom_hair_rgb` / `custom_eye_rgb` / `custom_body_rgb`：`r,g,b,w`（0–255 / 0–100；原作 UI 的 RGB 滑杆通常 0–128）。
  - `bg_rgb`：可选，背景色。

## 2. 目录与图层

部件按目录分图层；可选图层通过“与基础层同名（不含扩展名）”的文件自动关联。

| 分类 | 列表基础目录 | 可选图层目录 |
| --- | --- | --- |
| hair_front | `hair_front` | `hair_front_accessory` |
| hair_back | `hair_back` | `hair_back_accessory` |
| head | `head` | — |
| face | `face_front` | `face_back`, `face_haircolor` |
| eye | `eye` | `eye_color` |
| body | `body_back` | `body_front`, `body_front_color`, `body_front_accessory` |
| accessory | `accessory_back` | `accessory_underwear`, `accessory_middle_back`, `accessory_middle_front`, `accessory_front` |

说明：

- 原作的列表条目只由基础目录生成；其他目录仅作为同名附加层。这与本移植版一致。
- `eye_color` 目录存在时，`eye` 层不参与瞳色变换，`eye_color` 层参与；目录不存在时（v2 结构）`eye` 层参与瞳色变换。
- Windows 下 `.png` / `.PNG` 均可被原作列出；本移植版不区分大小写。
- 饰品名中的全角/半角括号均可识别颜色标记：`(髪)` `(瞳)` `(肌)` `(服)`。
- 原作只允许 `accessory_max` 个饰品（默认 6）；本移植版默认 6，可在界面调整 0–32。

## 3. 绘制顺序（从后到前）

1. `accessory_back`（选中饰品按列表倒序：列表末尾最先画）
2. `hair_back`
3. `hair_back_accessory`
4. `body_back`
5. `accessory_underwear`
6. `body_front`
7. `body_front_color`
8. `body_front_accessory`
9. `accessory_middle_back`
10. `head`
11. `accessory_middle_front`
12. `face_back`
13. 若 `face_layer=1`：`face_front`, `face_haircolor`
14. 若 `eye_layer=1`：`eye`, `eye_color`
15. `hair_front`
16. `hair_front_accessory`
17. 若 `face_layer=0`：`face_front`, `face_haircolor`
18. 若 `eye_layer=0`：`eye`, `eye_color`
19. `accessory_front`

饰品选择列表的顺序是“前 → 后”；渲染时倒序遍历，所以列表最后一个（最下方）最先画、最靠后。

## 4. 颜色算法

原作的 `imgctl.dll` 对颜色可变的图层执行：

### 4.1 ReplaceDIB —— 通道置换

参数来自 0–7 标准色板：

| 索引 | 名称 | 参数 (r,g,b) | 实际通道选择 (`param % 3`) |
| ---: | --- | --- | --- |
| 0 | 青 | 255,255,128 | R←R, G←R, B←B |
| 1 | 紫 | 128,255,128 | R←B, G←R, B←B |
| 2 | 赤 | 128,255,255 | R←B, G←R, B←R |
| 3 | 黄色 | 128,128,255 | R←B, G←B, B←R |
| 4 | 緑 | 255,128,255 | R←R, G←B, B←R |
| 5 | 水色 | 255,128,128 | R←R, G←B, B←B |
| 6 | 黒 | 0,0,0 | R←R, G←R, B←R |
| 7 | 白 | 128,128,128 | R←B, G←B, B←B |

即 `arg % 3` 选择源通道（0=R, 1=G, 2=B）写入目标 R/G/B。G 通道通常被忽略。

### 4.2 GammaDIB —— 伽马

参数 `p`（原作 500/550/700/750/850/1000/1250/1500/1750、skin 700–1600、custom 0–2000）：

```
out = round(255 * (in / 255) ^ (1000 / p))
p = 0: in == 255 ? 255 : 0
```

已对 `imgctl.dll` 的 0–2000 全部 2001×256 个值做过比较，公式零差异。

### 4.3 GrayDIB —— 去饱和

参数 `c = GRAY_CONTRAST[gray]`，gray 0–6 → `[0,32,64,128,192,224,255]`。

```
luma = (117*B + 601*G + 306*R + 512) >> 10
out  = floor((src*(255-c) + luma*c + 127) / 255)
```

这是 Rec.601 亮度的整数版本。

### 4.4 ShadeDIB —— 肤色

按通道分别乘：

```
out = round(in * shade / 1000)  // 上限 255
```

肤色表：

| skin_rgb | R | G | B |
| ---: | ---: | ---: | ---: |
| 0 標準 | 1000 | 1000 | 1000 |
| 1 褐色 | 900 | 700 | 700 |
| 2 黄色 | 1050 | 1050 | 1000 |
| 3 日焼け | 1200 | 950 | 950 |
| 4 不健康 | 1200 | 1050 | 1200 |
| 5 悪魔 | 750 | 750 | 1500 |

肤色明暗 `skin_gray` 对应 Gamma：`[1600,1400,1200,1000,900,800,700]`。

### 4.5 ToneDIB —— 自定义色/全局增亮

```
out = min(255, in + param)  // 每通道
```

- 自定义色：`ReplaceDIB(0,0,0)` → `GammaDIB(w*20)` → `ToneDIB(custom_r,g,b)` → `GrayDIB(0)`。
- 全局 `tone_rgb = 2`：原作对所有层（包括不可变色层）最后加 2。

### 4.6 应用到哪些层

| 层 | 变换 |
| --- | --- |
| hair_front, hair_back, face_haircolor | 头发颜色 |
| eye_color；无 eye_color 目录时 eye | 瞳色 |
| body_front_color | 服装颜色 |
| body_back, head | 肤色 Shade + Gamma |
| 饰品文件名含 `(髪)`/`(瞳)`/`(肌)`/`(服)` | 对应颜色；多个标记按 髪→瞳→肌→服 顺序依次执行 |
| 其他层 | 仅全局 +2 |

黑/白标准色（6/7）使用 Gamma 覆盖表：`[1750,1500,1250,1000,850,700,550]`（gray 0–6）。

### 4.7 透明通道

原作用 RGB DIB + 独立 alpha DIB，再用 HSP 的 alpha 混合合成。本移植版直接保留 PNG 的 straight alpha，按标准 over 合成：

```
outA = sa + da*(1-sa)
outC = (srcC*sa + dstC*da*(1-sa)) / outA
```

普通导出以背景色作为不透明底层；透明导出以 alpha=0 为底层。

## 5. .cpd / .dat

两者结构相同（原作 `.cpd` 与 `profile/*.dat`）：

```ini
[Character]
name=<模板ID>
[Parts]
hair_front=...
hair_back=...
head=...
face=...
eye=...
body=...
accessory=a,b,c
[Color]
hair_rgb=...
hair_gray=...
custom_hair_rgb=r,g,b,w
...
bg_rgb=255,255,255
```

- 原作 `.cpd` 通常为 CP932；本移植版可读 CP932/UTF-8/UTF-16，写出时优先 CP932，无法表示时回退 UTF-8 BOM 并在响应头/界面提示。
- 键顺序与原作 `WritePrivateProfileStringA` 的写法一致；无空行，CRLF。
- `name` 必须与当前模板目录名一致才符合原作规则；本移植版会提示但不强制阻止。
- 原作的旧版本（v2）可能没有 `custom_*_rgb`，且使用 8/9/10 号棕色/橙色/桃色；本移植版按原作 `label_55` 的兼容表转换成自定义色。

## 6. 输出格式

| 输出 | 实现 |
| --- | --- |
| PNG 不透明 | 32-bit RGBA 编码但 alpha 全 255 / 或 RGB PNG |
| PNG 透明 | 保留 straight alpha |
| BMP | 24-bit BGR，bottom-up，行 4 字节对齐 |
| JPEG | sharp/mozjpeg，质量 1–100 |
| GIF | sharp/cgif，256 色 |
| PNA | 8-bit 灰度 PNG，灰度值 = alpha |
| 伺か surface | 24-bit RGB + 自动选色键；alpha < 阈值 → 色键；左上角强制色键 |

伺かの颜色键算法与原 `charaex.dll` 不保证一致；结构、PNA 语义和 SSP 可读性兼容。

## 7. 逐像素验证

测试方法：构造 ASCII 文件名的模板（避免原版在非日文 ANSI 环境下 `GetPrivateProfileStringA` 乱码），用原作 profile 载入同一状态，通过窗口预览截图取 300×400 预览区；本移植版渲染同状态 PNG；比较 RGB。

| 用例 | mean | max | >15 |
| --- | ---: | ---: | ---: |
| 默认：hair 红/eye 红/body 蓝/skin 标准 | 0.084 | 6 | 0 |
| custom hair w80 / eye 黑 gray6 / body 白 / skin 悪魔 gray6 | 0.089 | 6 | 0 |
| hair 白 / eye custom / body 红 / skin 日焼け | 0.088 | 7 | 0 |
| hair 水色 / eye 紫 / body 緑 / skin 黄色 | 0.087 | 6 | 0 |
| eye_layer=1 + face_layer=1 | 0.081 | 6 | 0 |
| 左右翻转 | 0.084 | 6 | 0 |
| 多层饰品（back/front/middle_back） | 0.084 | 6 | 0 |

360,000 个通道中仅 1–3 个通道差 >5，均位于抗锯齿边缘。

## 8. 已知差异

- 网页 UI 不复刻桌面窗口的“列表/下拉列表显示形式”“窗口尺寸”等纯桌面行为。
- `.dat` 自动保存改为 localStorage；`.cpd` 是跨程序交换格式。
- JPEG/GIF 编码器不同，文件字节不同。
- 伺か surface/PNA 为独立实现。
- 模板排序使用 `Intl.Collator('ja')`，与原作 `hspda.dll` 的字节排序可能有个别顺序差异。
- 不直接解析 ZIP 模板（文件夹上传/服务器路径导入）。
- 低分辨率预览与截图取色会引入极少量舍入差异；实际导出的 PNG 使用整数像素变换。
