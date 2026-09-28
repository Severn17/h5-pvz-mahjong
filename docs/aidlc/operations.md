# Operations：运行、CI 与部署

## 本地运行

```bash
npm start   # python3 -m http.server 8080
npm test    # node --test tests/*.test.js
```

纯静态文件，任意静态服务器都能跑。`?seed=123` 固定牌山。

## CI

`.github/workflows/test.yml`：每次 push / PR 在 Node 20 上运行 `npm test`。

## 部署

学习展示用的在线试玩：GitHub Pages 直接发布 `mahjong` 分支根目录，无构建步骤。

地址：<https://yangshiqi.cn/h5-pvz-mahjong/>

## 计划中（M5）

- 埋点：单局时长、胡牌率、各番型出现率、各关失败点
- 替换全部原版素材后，才考虑学习展示以外的正式发布
