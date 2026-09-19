# DrawBox

DrawBox 是一个纯静态 AI 提示词画廊，使用 HTML、CSS、JavaScript 和 JSON 数据构建。

在线地址：https://angel-gril.github.io/DrawBox/

## 功能

- 分类浏览与全文搜索
- 完整素材库：浏览 20,070 张独立备份图片
- 详情查看与图片灯箱
- 本地收藏，无需账号
- 深色模式

## Codex Skill

仓库内含 `skills/drawbox-prompt-match`，用于将上传的参考图转换为视觉 JSON、匹配 DrawBox 提示词，并整理可继续用于图像生成的 prompt。

安装到本机 Codex 技能目录：

```powershell
Copy-Item -Recurse -Force ".\skills\drawbox-prompt-match" "$env:USERPROFILE\.codex\skills\"
```

调用时可以让 Codex 使用 `$drawbox-prompt-match` 分析参考图并检索匹配提示词。该 skill 默认读取线上 DrawBox 数据，也支持通过 `--root` 使用本地仓库数据。
