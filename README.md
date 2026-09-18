# DrawBox

DrawBox 是一个纯静态 AI 提示词画廊，使用 HTML、CSS、JavaScript 和 JSON 数据构建，可以直接部署到 GitHub Pages。

当前主站数据引用 5,452 张图片，其中 5,443 张已成功迁移，原始文件总量 2.35 GiB，不压缩、不改文件名。图片分为 4 个辅助 GitHub Pages 仓库，每个仓库约 450-650 MiB。

## 本地预览

需要 Node.js 20 或更高版本：

```bash
npm run serve
```

然后访问 `http://127.0.0.1:8080/`。

## 目录

- `index.html`：首页
- `gallery.html`：画廊
- `categories.html`：分类总览
- `search.html`：搜索
- `favorites.html`：本地收藏
- `detail.html`：提示词详情
- `data/`：分片数据与图片路由表
- `js/config.js`：站点与图片仓库配置
- `tools/`：图片下载、分片和本地服务器脚本

## 图片仓库

图片不放进主站仓库。完整迁移流程：

```bash
npm run images:download -- --origin https://你的现有图片域名 --out images-source
npm run images:plan -- --source images-source --repo-size-mib 650
npm run images:shard -- --source images-source --repo-size-mib 650 --apply
```

当前数据会得到：

- `image-shards/drawbox-img-01/` 至 `drawbox-img-04/`
- `data/image-map.json`：每张图片对应的仓库
- `tools/config-snippet.json`：推荐配置

为每个 `drawbox-img-*` 目录创建同名公开 GitHub 仓库，把对应目录内容放在仓库根目录，然后在仓库设置中开启 GitHub Pages。最后把 `pagesOrigin` 写入 `js/config.js`：

```js
pagesOrigin: "https://你的GitHub用户名.github.io"
```

例如仓库 `drawbox-img-01` 中的：

```text
images/originals/14347.jpg
```

最终会从下面的地址访问：

```text
https://你的GitHub用户名.github.io/drawbox-img-01/images/originals/14347.jpg
```

详细说明见 `tools/README.md`。
