# キャラクターなんとか機 Web (CharacterManaW)

一个把日本独立工具 **「キャラクターなんとか機」Ver 3.07** 移植到浏览器 / Node.js 的项目。

- 原软件：K.Hmix 1st Edition（緋龍華 麒麟）http://khmix.sakura.ne.jp/
- 本移植版：Node.js + Express 后端，原生 ES Modules 前端，无桌面运行环境依赖。
- 内置模板：**只有 `data/default`**（原作安装包自带的内容）。其他模板在部署后由用户从本地导入，导入时复制到 `data/library`，不会修改源目录。

> 本项目不是原作作者的官方版本。原作 default 素材的再分发条件见 `data/default/readme.txt` 与 [NOTICE.md](NOTICE.md)。

---

## 1. 功能

### 1.1 原作核心功能

- 读取 `data/<角色>/character.ini` 与图层目录。
- 7 个部件分类：前发、后发、头、表情、眼、身体/服装、饰品。
- 多图层合成，完全按原作的图层顺序和特殊图层规则（眼角/眉毛在头发下、饰品 5 层、头发/身体附件层）。
- 8 色调色板 + 自定义 RGB/明暗、7 档明暗、6 种肤色；按原作 `imgctl.dll` 的 RGB 通道置换 / Gamma / Gray / Shade / Tone 算法逐像素还原。
- 饰品上下层序、数量上限、多选、文件名中的 `(髪)` `(瞳)` `(肌)` `(服)` 颜色联动。
- 左右翻转、背景色、眼角/眉毛图层设置。
- 随机生成（含原作的随机选项：发型、头、表情、眼、身体、饰品、颜色、自定义颜色）。
- 读取/保存 `.cpd` 角色设定；也读取与原作 `.dat` 相同结构的 profile 文件。
- 输出 PNG / BMP / JPEG / GIF；透明 PNG；伺か surface PNG + PNA ZIP。
- 原作 `no_antialiasing` 对应的边缘阈值。
- 角色 readme / 模板信息显示。

### 1.2 追加功能

- **模板导入与文字编码自动识别**
  - 浏览器文件夹上传（`webkitdirectory`）。
  - 本地服务器路径导入（仅 loopback 默认开放）。
  - 自动识别 CP932 / Shift-JIS、EUC-JP、UTF-8（含 BOM）、UTF-16LE/BE（含 BOM）。
  - 读取 `readme.txt` 时同样自动解码，不再出现日文乱码。
- **中文 / English / 日本語界面**
  - 右上角切换；默认按浏览器语言自动选择（zh → 中文，en → English，其他 → 日本語）。
  - 部件名、readme 保持原模板文字；分类名使用模板自带的 `ja/zh/en` 或内置翻译。
- **多表情 / 多衣装变体**
  - 勾选要变化的分类，其余分类锁定为当前状态。
  - 组合数预览、截断提示。
  - 交错采样预览（避免只看到同一个表情/同一套衣服）。
  - 选择子集或全部组合，导出 PNG ZIP + `variants.json` + `variants.csv`。
- **BYOK LLM 提示词工坊**
  - 支持 OpenAI-compatible（含自建/中转）、Anthropic、Google Gemini。
  - 把当前角色的部件名、颜色、模板 readme 摘要作为上下文。
  - **可附加当前预览 PNG 作为视觉输入**，让视觉模型直接“看图”推导提示词；也可取消勾选，仅用部件信息生成。
  - 按目标模型（GPT-Image、Nano Banana、Z-Image、Anima、Lumina、通用）生成正向/负向提示词、标签、说明。
  - API Key 仅随本次请求发送，不写入服务器日志/数据库；勾选“在此标签页记住”时存 `sessionStorage`。

---

## 2. 快速启动

要求：Node.js **20+**（开发/验证使用 Node 26）。首次需要安装依赖：

```powershell
cd D:\Temp2\Project1
npm install
npm start
```

默认地址：<http://127.0.0.1:8787>

如果 `node_modules` 已随项目提供，可直接 `npm start`。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 监听地址；远程访问设为 `0.0.0.0` |
| `ALLOW_LOCAL_IMPORT` | 自动 | `1` 强制允许服务器路径导入，`0` 禁止；默认仅 loopback 允许 |
| `NODE_ENV` | — | `production` 时静态资源缓存 1 小时 |

远程部署示例：

```powershell
$env:HOST='0.0.0.0'
$env:PORT='8787'
$env:ALLOW_LOCAL_IMPORT='0'
npm start
```

> 本应用没有账号系统。暴露到公网前请放在反向代理/认证之后；路径导入和模板删除是本地管理功能。

---

## 3. 使用

### 3.1 载入模板

1. 点击右上角 **テンプレート読込 / 导入模板 / Import template**。
2. 两种方式：
   - **フォルダをアップロード**：选择包含 `character.ini` 和图层文件夹的目录。文件夹名会作为模板 ID，文件名和相对路径原样保留。
   - **サーバー上のパス**：输入本机绝对路径（例如 `D:\Dropbox\着せ替え\data\MIYU`）。服务端会复制到 `data/library/<id>`，不改动源目录。仅本地访问时默认可用。
3. 导入成功后自动切换到新模板。

`data/default` 是内置模板，不能删除。导入模板可在导入对话框中删除。

### 3.2 编辑

- 左侧分类标签切换部件；搜索框过滤；缩略图按需加载。
- 点击部件即应用。饰品点击加入/移除；已选饰品在下方按“前 → 后”排序，可用 ↑/↓ 调整。
- 右侧颜色区：色板、明暗滑杆、自定义 RGB/明暗。
- 显示选项：眼睛/眉毛在头发下、背景色、饰品上限。
- 工具条：缩放、适应、左右翻转、透明预览、随机、重置（角色初始 / 启动时状态）。

### 3.3 设定文件（.cpd / .dat）

- **设定を保存 (.cpd)**：下载与原作同结构的 Shift-JIS `.cpd`。包含 `[Character]`、`[Parts]`、`[Color]` 全部键。
- **设定を読込 (.cpd)**：选择 `.cpd` 或 `.dat`；自动识别编码。
  - 若 `[Character] name` 与当前模板 ID 不同，会提示，但仍允许检查/应用。
  - 不存在的部件会回退到模板默认值。
- 浏览器会自动把当前状态保存到 `localStorage`（相当于原作的 profile 自动保存）；无需 .dat 文件即可恢复。
- 与原作兼容性：原作生成的 `.cpd` 可由本应用读取；本应用导出的 CP932 `.cpd` 也可作为原作的 profile/.cpd 使用（ASCII 名称已验证；日文名称要求原作运行在日文 ANSI 代码页环境）。

### 3.4 图片输出

| 格式 | 说明 |
| --- | --- |
| PNG | 默认包含背景色；勾选“背景を透過”输出 RGBA 透明 PNG |
| BMP | 24-bit，包含背景色 |
| JPEG | 包含背景色，质量可调 |
| GIF | 包含背景色，256 色量化 |
| 伺か surface + PNA | ZIP：surface PNG（颜色键透明）+ PNA（alpha 灰度 PNG）+ RGBA PNG + JSON 元数据 |
| PNA | 单独的 alpha 灰度 PNG |

倍率 1×–4×（扩展功能；原作只按原尺寸输出）。

伺か导出的 `輪郭しきい値` 对应原作的 `no_antialiasing` 0–5，值越大越容易去掉半透明边缘。surface 的颜色键选择和 PNA 生成是独立实现，结构兼容 SSP/伺か，但不保证与原 `charaex.dll` 的输出字节级一致。

### 3.5 多表情 / 多衣装

1. 点击 **バリエーション / 多表情・多衣装 / Variants**。
2. 勾选参与变化的分类（表情、身体/服装、发型、眼睛、头等）；未勾选的保持当前选择（锁定）。
3. 在下方勾选每个分类要包含的部件；可搜索/全选/清空。
4. **組み合わせを確認** 显示组合数；超过 512 会截断并提示。
5. **先頭をプレビュー** 生成最多 24 张交错采样预览；勾选想要导出的项。
6. **選択を ZIP** 导出选中项；**全件を ZIP** 导出全部已计划组合。
   - ZIP 含每个变体的 PNG、`variants.json`（完整状态）、`variants.csv`（表格）。

### 3.6 BYOK 提示词

1. 点击 **プロンプト作成 / 提示词生成 / Prompt studio**。
2. 选择提供商，填 Base URL / 模型 / API Key；选择目标生图模型和提示词语言；可填写角色/场景要求。
3. 对话框会自动生成当前状态的干净预览 PNG。预览就绪后：
   - **勾选“当前预览图作为视觉输入”**：PNG 会随请求发送给 LLM，要求模型“看图”推导提示词。
   - **取消勾选**：只发送部件名、颜色和 readme 摘要，不发送图片。
4. 生成结果包含 Prompt、Negative prompt、Tags、Notes；可复制或下载 JSON。
5. 把 Prompt 粘到对应生图模型。**本应用不调用生图 API；只有勾选参考图时，预览 PNG 会发送给你选择的 LLM 提供商。**

> 图像输入需要使用支持视觉的模型（例如 `gpt-4o-mini`、Claude 3.5 Sonnet、Gemini 2.0 Flash，或你的中转服务提供的视觉模型）。如果模型不支持图像，提供商会返回错误。预览图在服务器端只用于本次转发，不落盘、不写入日志；超过 1024px 的长边会在浏览器端等比缩小。

#### 提供商示例

| 提供商 | Base URL | 模型示例 |
| --- | --- | --- |
| OpenAI-compatible | `https://api.openai.com/v1` 或你的中转 `/v1` | `gpt-4o-mini`、任意兼容模型 |
| Anthropic | `https://api.anthropic.com` | `claude-3-5-sonnet-latest` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.0-flash` |

API Key 的隐私边界：Key 从浏览器发送到本 Node 服务，再由服务端请求 LLM；服务端不会持久化或主动记录 Key。若你把服务部署在他人可控的机器上，服务端运营者理论上可见请求内容。

---

## 4. 兼容性 / 还原度

已用原作 `character.exe` 的实时预览截图与移植版逐像素对照（相同 ASCII 测试模板、相同部件/颜色、相同图层设置）：

| 用例 | 平均通道差 | 最大通道差 | >15 的通道数 |
| --- | ---: | ---: | ---: |
| 默认角色（红发/蓝服/标准肤色） | 0.084 | 6 | 0 |
| 自定义发色 + 黑眼 + 白衣 + 恶魔肤色 | 0.089 | 6 | 0 |
| 白发 + 自定义瞳色 + 红衣 + 日晒肤色 | 0.088 | 7 | 0 |
| 青发 + 紫眼 + 绿衣 + 黄色肤色 | 0.087 | 6 | 0 |
| 眼角/眉毛在头发下 | 0.081 | 6 | 0 |
| 左右翻转 | 0.084 | 6 | 0 |
| 多层饰品 | 0.084 | 6 | 0 |

差异集中在少数边缘抗锯齿像素，属于预览截图/合成舍入误差；颜色、图层、饰品、翻转等核心结果一致。

详细格式与算法说明见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

---

## 5. 目录结构

```
.
├─ server/
│  ├─ index.js          Express API
│  ├─ templates.js      模板扫描/导入/编码
│  ├─ encoding.js       CP932/EUC-JP/UTF-8/UTF-16 检测
│  ├─ cpd.js            .cpd / .dat 读写
│  ├─ colors.js         原作颜色算法
│  ├─ render.js         图层合成/翻转/缩略图
│  ├─ image.js          PNG/BMP/JPEG/GIF/PNA/surface
│  ├─ variants.js       多组合计划/预览/ZIP
│  ├─ llm.js            BYOK LLM 代理
│  └─ state.js          状态校验
├─ web/                 浏览器前端（HTML/CSS/ES Modules）
├─ data/default/        唯一内置模板
├─ data/library/        用户导入模板（运行时生成）
├─ test/                Node 测试（颜色/编码/CPD/渲染/变体）
├─ docs/                兼容性与许可说明
└─ README.md
```

运行时还会生成 `data/tmp`（上传临时文件）和 `data/library`（导入模板），可安全清空；缩略图与渲染缓存只保存在进程内存中。

---

## 6. 测试

```powershell
npm test
```

测试覆盖：

- 原作颜色算法（Replace / Gamma / Gray / Shade / Tone）的已知输入输出。
- CP932 / UTF-8 / UTF-16 编码检测与 `.cpd` 往返。
- 内置 default 模板分类/部件数、默认渲染图层数、透明画布。
- 图层合成、翻转、变体笛卡尔积与上限。

---

## 7. 已知限制

- **伺か surface/PNA**：结构兼容，但颜色键选择与阈值处理是独立实现，不保证与原 `charaex.dll` 字节一致。
- **JPEG/GIF**：使用 sharp 的 mozjpeg/cgif 编码，和原 `imgctl.dll` 的编码器不同；视觉一致，文件字节不同。
- **`.dat` 自动保存**：本移植版用浏览器 localStorage，不写 `profile/*.dat`；`.cpd` 导入/导出是跨程序交换格式。
- **原文具列表形式**：原作的“パーツ選択の表示形式”下拉列表选项没有逐字复刻，改为分类标签 + 搜索 + 缩略图，功能等价且更适合大量部件。
- **窗口缩放相关选项**：浏览器自适应，不再有 `window_resize` 桌面窗口逻辑。
- **压缩包导入**：当前提供文件夹上传和服务器路径导入，未直接解析 ZIP（避免 ZIP 文件名编码歧义）。可先解压再选文件夹。
- **超大模板**：`data/sozai7` 这类包含数千部件、1443 饰品的模板可以扫描/渲染，但缩略图按需生成，首次滚动可能较慢。
- **图像输入**：需要 LLM 提供商/模型支持视觉输入；纯文本模型会报错。预览图会作为请求内容发送给该提供商。
- **安全**：无账号/权限系统；远程部署请加认证。路径导入默认仅 loopback。

---

## 8. 许可

- 本移植版代码：MIT，见 [LICENSE](LICENSE)。
- 原作 default 素材：按原作 readme 的再分发条件，见 `data/default/readme.txt`。
- 第三方依赖：MIT / Apache-2.0，详见 [NOTICE.md](NOTICE.md)。

再次强调：本应用只内置 `data/default`。`data/library` 中的其他模板由用户自行导入，其版权/使用条件由对应素材作者决定。
