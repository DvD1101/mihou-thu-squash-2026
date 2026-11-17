# DeepSeek Harness 迁移说明

## 推荐上传

上传“源码安全包”，不要上传包含管理员链接和参赛者数据的“数据恢复包”。

## 新环境启动

要求 Node.js 22 或更高版本。

```bash
npm ci
npm test
npm run start
```

本机管理链接会输出在终端中。

## 继续 Cloudflare 开发

```bash
npm run cloudflare:dev
npm run cloudflare:deploy
```

首次使用新环境部署前：

1. 登录 Cloudflare：
   ```bash
   npx wrangler login
   ```
2. 设置管理员密钥：
   ```bash
   npx wrangler secret put ADMIN_TOKEN
   ```
3. 应用 D1 迁移：
   ```bash
   npm run cloudflare:migrate
   ```
4. 部署：
   ```bash
   npm run cloudflare:deploy
   ```

## 配置

- Worker：`mihoo-squash-2026`
- D1：`mihoo_event_state`
- D1 ID：`09c0599c-d093-474d-a924-b9798cf4c4c9`
- Cloudflare Account ID：`2a4f953de03da3ed457a2aac3fa4536b`
- 正式域名：`www.mihoosquash.com`
- 赛事路径：`/events/2026-thu-nine-school/`

## 禁止迁移的内容

以下内容不应上传到任何外部 AI Harness：

- `ADMIN_TOKEN`
- Cloudflare OAuth/API Token
- Netlify Auth Token
- GitHub Token
- `work/` 中的登录状态、临时令牌和本机测试数据
- 含参赛者真实姓名和院系的数据恢复包

代码和数据结构可以完整迁移；密钥应在目标环境中重新设置。
