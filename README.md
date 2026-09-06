# AI Job Copilot — Web 前端

你的 Dify 工作流（简历 × JD 匹配评估）的 Web 前端。暖白编辑风界面，后端代理调用 Dify 工作流 API。

## 安全设计（重要）

- **Dify API Key 只存在于服务端 `.env` 环境变量**，永不发送到浏览器；
- 前端页面只与本站后端通信，由后端代为调用 Dify 的文件上传与工作流 API；
- 后端日志与错误响应中不包含任何密钥信息；
- DeepSeek API Key 配置在 Dify 平台侧，本应用完全不经手。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
#    编辑 .env，填写 DIFY_BASE_URL 和 DIFY_API_KEY
#    （Dify 云版: https://api.dify.ai/v1 ；自部署: http://<host>/v1）
#    Key 在 Dify 应用「API 访问」页生成

# 3. 启动
npm start
# 访问 http://localhost:8787
```

## 演示模式（先看界面效果）

不配置 Key 时，可在 `.env` 中设 `DIFY_MOCK=true`，提交后会展示一组示例数据（页面会明确标注为演示数据），便于先确认界面与交互。

## 工作流输入约定

应用按你的工作流输入变量提交：

| 工作流变量 | 提交内容 |
| --- | --- |
| `job_title` | 岗位名称（文本） |
| `jd_text` | 职位描述（文本） |
| `resume` | 简历文件（先经 Dify `/v1/files/upload` 上传，再以 `local_file` 引用传入） |

## 部署到服务器

```bash
# 方式一：直接运行（建议用 pm2 守护）
npm install -g pm2
pm2 start server.js --name ai-job-copilot
pm2 save

# 方式二：Docker（可选）
# FROM node:20-alpine
# WORKDIR /app
# COPY package*.json ./
# RUN npm install --omit=dev
# COPY . .
# EXPOSE 8787
# CMD ["node", "server.js"]
```

生产环境建议置于 Nginx / Caddy 反向代理之后并启用 HTTPS。

## 项目结构

```
ai-job-copilot-web/
├── server.js          # Express 后端：健康检查、文件上传代理、工作流调用
├── package.json
├── .env.example       # 环境变量模板（复制为 .env 使用）
├── public/
│   ├── index.html     # 页面结构
│   ├── style.css      # ElevenLabs 风格样式
│   └── app.js         # 前端交互与结果渲染
```

## API

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查，返回配置状态（不含密钥） |
| `POST /api/run` | multipart 提交 `job_title` / `jd_text` / `resume`，返回评估结果 JSON |
