# DrawBox tools

这些脚本只依赖 Node.js，不需要安装 npm 包。

## 1. 下载图片

```bash
node tools/download-images.mjs --origin https://你的现有图片域名 --out images-source
```

脚本会扫描 `data/list.part*.json` 与 `data/prompts.part*.json`，提取唯一的图片路径并保持原目录结构下载。已经存在且非空的文件会跳过，因此中断后可以直接重跑。

常用参数：

- `--concurrency 6`：并发下载数
- `--retries 3`：失败重试次数
- `--limit 100`：只下载前 100 张，用于测试
- `--overwrite`：重新下载并覆盖已有文件

当前数据实测：

- 引用图片：5,452 张
- 成功迁移：5,443 张
- 源文件：2.35 GiB
- 上游失效路径：9 张，站点会在图片加载失败时显示分类色块占位

9 个失效路径：

```text
images/originals/14774.jpg
images/originals/20007.jpg
images/originals/20325.jpg
images/originals/22704.jpg
images/originals/25396.jpg
images/originals/28118.jpg
images/originals/28124.jpg
images/originals/28705.jpg
images/twitter/2082005807676420128.jpg
```

## 2. 规划图片仓库

```bash
node tools/build-image-shards.mjs --source images-source --repo-size-mib 650
```

默认只生成计划，不复制文件。计划写入 `tools/image-shard-plan.json`，包含每个 `drawbox-img-*` 本地分片的容量、文件列表和仓库总数。

GitHub Pages 单个已发布站点约为 1 GB，但还需要留意：

- GitHub 不建议单个 Git 仓库长期超过约 1 GB
- 本地 clone 同时存在工作区和 `.git` 对象，文件总量会近似翻倍
- GitHub 单个文件硬上限为 100 MiB

因此即使图片总量允许，也不建议把单个图片仓库做满 1 GB。当前 2.35 GiB 数据使用 650 MiB 容量会生成 4 个仓库：

```text
drawbox-img-01  650 MiB
drawbox-img-02  650 MiB
drawbox-img-03  650 MiB
drawbox-img-04  452 MiB
```

如果只追求最少仓库数量，可以使用 `--repo-size-mib 820 --repos 3` 生成 3 个仓库；如果更重视 Git 仓库大小和后续增量更新，则 650 MiB 或 450 MiB 更稳妥。

## 3. 生成图片仓库

```bash
node tools/build-image-shards.mjs --source images-source --repo-size-mib 650 --apply --owner 你的GitHub用户名
```

脚本会：

1. 建立 `image-shards/drawbox-img-01/` 等目录
2. 原样复制图片，不压缩、不改文件名
3. 为每个仓库加入 `.nojekyll` 和 `README.md`
4. 生成 `data/image-map.json`
5. 生成 `tools/config-snippet.json`

如果本地图片已经有改动，想重新复制，可加 `--overwrite`。

## 4. 发布图片仓库

发布时，把四个本地分片分别推送到 `DrawBoxAssets` 组织下的公开仓库：

```text
image-shards/drawbox-img-01  ->  DrawBoxAssets/img-01
image-shards/drawbox-img-02  ->  DrawBoxAssets/img-02
image-shards/drawbox-img-03  ->  DrawBoxAssets/img-03
image-shards/drawbox-img-04  ->  DrawBoxAssets/img-04
```

对每个仓库：

1. 把对应的 `image-shards/drawbox-img-*` 目录内容放在仓库根目录
2. 在 `Settings > Pages` 中选择 `Deploy from a branch`
3. 选择 `main` 分支和 `/ (root)`
4. 等待 Pages 发布

主站图片地址由 `data/image-map.json` 中的完整 URL 决定，例如：

```text
https://drawboxassets.github.io/img-01/images/originals/14347.jpg
```

`js/config.js` 中的 `pagesOrigin` 仅作为后备配置；当前路由优先使用 `image-map.json`。

## 本地服务器

```bash
node tools/serve.mjs .
```

可通过 `PORT=9000` 修改端口，例如 PowerShell：

```powershell
$env:PORT=9000; node tools/serve.mjs .
```

本地服务器会自动读取 `data/image-map.json`，把 /images/... 请求映射到 `image-shards/` 中对应的图片仓库，因此发布前也可以直接预览原图。
