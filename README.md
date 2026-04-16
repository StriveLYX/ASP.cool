<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ASP.Cool - 设计创意课程平台

一个完整的课程会员网站，包含前端展示页面、支付宝支付集成和 Node.js 后端服务。

## 在线访问

- **前端页面**: [apply.asp.cool](https://apply.asp.cool)（部署在 Vercel）
- **后端 API**: [api.apply.asp.cool](https://api.apply.asp.cool)（部署在云服务器）

## 项目结构

```
ASP.cool/
├── index.html              # 主页面（课程介绍 + 会员定价 + 支付）
├── tutorial.html           # 网站开发完整教程
├── server/
│   ├── server.js           # Node.js 后端（Express + 支付宝 SDK）
│   ├── package.json        # 后端依赖
│   ├── private-key.pem     # 应用私钥（需自行配置）
│   └── alipay-public-key.pem  # 支付宝公钥（需自行配置）
├── vercel.json             # Vercel 部署配置
└── ASP.Cool后端部署指南.docx   # 后端部署完整教程
```

## 快速开始

### 前端（本地预览）

直接在浏览器打开 `index.html` 即可预览。

### 后端（本地运行）

```bash
cd server
npm install
# 沙箱测试
node server.js --sandbox
# 生产环境
node server.js
```

## 部署

### 前端部署（Vercel）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/StriveLYX/ASP.cool&branch=Payment)

1. 点击上方按钮一键部署到 Vercel
2. 在 Vercel 控制台绑定自定义域名 `apply.asp.cool`
3. 在域名 DNS 设置中添加 CNAME 记录指向 Vercel

### 后端部署（云服务器）

详见 [ASP.Cool后端部署指南.docx](./ASP.Cool后端部署指南.docx)，涵盖：

- 服务器环境搭建（Node.js + PM2 + Nginx）
- 代码上传与密钥配置
- Nginx 反向代理配置
- HTTPS/SSL 证书申请
- DNS 解析配置
- 完整测试验证流程

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + JavaScript（原生） |
| 后端 | Node.js + Express |
| 支付 | 支付宝电脑网站支付（alipay-sdk） |
| 部署 | Vercel（前端）+ 云服务器（后端） |
| 反向代理 | Nginx |
| HTTPS | Let's Encrypt (Certbot) |

## 相关文档

- [ASP.Cool支付接入配置指南.docx](./ASP.Cool支付接入配置指南.docx) - 支付宝支付接入详细配置
- [ASP.Cool后端部署指南.docx](./ASP.Cool后端部署指南.docx) - 后端服务器部署完整教程
- [tutorial.html](./tutorial.html) - 网站开发完整学习教程

## License

MIT
