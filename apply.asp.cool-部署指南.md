<!-- # apply.asp.cool 支付宝支付部署完整指南

## 📚 目录
1. [核心概念解析](#核心概念解析)
2. [架构设计](#架构设计)
3. [详细部署步骤](#详细部署步骤)
4. [故障排查](#故障排查)

---

## 核心概念解析

### 1. DNS（域名系统）- "通讯录"

**类比**：DNS 就像是手机的**通讯录**。

| 现实场景 | 网络世界 |
|---------|---------|
| 你记住朋友的名字 "张三" | 用户记住域名 `apply.asp.cool` |
| 通讯录把 "张三" 映射到手机号 "138xxxx" | DNS 把域名映射到 IP 地址 `124.220.79.244` |
| 换手机号了，更新通讯录即可 | 换服务器了，更新 DNS 记录即可 |

**作用**：让用户可以用好记的域名访问网站，而不是难记的数字 IP。

**关键术语**：
- **A 记录**：把域名指向一个 IPv4 地址（如 `76.76.21.21`）
- **CNAME 记录**：把域名指向另一个域名（如 `cname.vercel-dns.com`）

---

### 2. SSL/HTTPS - "密封信封"

**类比**：HTTP 就像**明信片**，HTTPS 就像**密封信封**。

| HTTP | HTTPS |
|-----|-------|
| 明信片：邮递员可以看到内容 | 密封信封：只有收件人能打开 |
| 容易被偷看、篡改 | 加密传输，安全可靠 |
| 地址以 `http://` 开头 | 地址以 `https://` 开头，有锁图标 |

**为什么需要 HTTPS？**
1. **安全性**：保护用户的支付信息不被窃取
2. **浏览器限制**：现代浏览器禁止 HTTPS 页面调用 HTTP 接口（混合内容阻断）
3. **信任度**：用户看到锁图标更放心

**SSL 证书**：就像信封上的"防伪标签"，证明这个网站是真实的，不是假冒的。

---

### 3. 服务器 vs 客户端 - "餐厅比喻"

| 角色 | 类比 | 职责 |
|-----|------|------|
| **客户端** (浏览器/index.html) | 顾客 | 看菜单、下单、付钱 |
| **服务器** (server.js) | 后厨 | 接收订单、处理支付、上菜 |
| **数据库** | 仓库 | 存储订单记录 |

**交互流程**：
```
顾客(浏览器) → 我要支付 → 服务员(Nginx) → 后厨(Node.js) 
                                         ↓
顾客(浏览器) ← 支付链接 ← 服务员(Nginx) ← 支付宝 API
```

---

### 4. 端口 - "餐厅包间号"

**类比**：IP 地址是餐厅地址，端口就是**包间号**。

| 端口 | 用途 | 类比 |
|-----|------|------|
| 80 | HTTP 默认端口 | 大堂普通座位 |
| 443 | HTTPS 默认端口 | VIP 包厢 |
| 3000 | 你的 Node.js 服务 | 后厨专用通道 |
| 22 | SSH 远程登录 | 员工通道 |

**为什么需要端口？** 一台服务器可以运行多个服务，端口用来区分它们。

---

### 5. Nginx - "餐厅前台"

**类比**：Nginx 就像是餐厅的**前台经理**。

**职责**：
1. **迎宾**：客人来了，引导到正确位置
2. **分流**：点餐的去大堂，外卖的走后门
3. **安全**：检查客人有没有预约（SSL）
4. **缓存**：记住常客的喜好，加快服务

**在支付宝项目中的作用**：
```
用户请求 apply.asp.cool/
        ↓
    Nginx 判断：
        - 是 /api/xxx ? → 转发到 Node.js (3000端口)
        - 是 /xxx.html ? → 直接返回文件
        - 是 http ? → 重定向到 https
```

---

### 6. 防火墙/安全组 - "小区保安"

**类比**：安全组就像是小区的**保安系统**。

| 场景 | 网络世界 |
|-----|---------|
| 业主刷卡进门 | 允许特定 IP 访问服务器 |
| 访客需要登记 | 开放特定端口给所有人 |
| 陌生人禁止入内 | 拒绝未授权的连接 |

**为什么需要配置？**
- 默认情况下，服务器只开放 22 端口（SSH）
- 要让网站可访问，必须"放行" 80 和 443 端口
- 否则用户访问会显示"连接超时"

---

## 架构设计

### 最终架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
│                   https://apply.asp.cool                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Vercel (前端托管)                        │
│                   - index.html                              │
│                   - 静态资源                                │
│                   - 反向代理规则                             │
└───────────────────────────┬─────────────────────────────────┘
                            │ /api/create-order
                            │ (Vercel 代理转发)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   腾讯云服务器                               │
│              124.220.79.244:3000                            │
│                   - Node.js                                 │
│                   - server.js                               │
│                   - 支付宝 SDK                              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      支付宝服务器                            │
│              https://openapi.alipay.com                     │
└─────────────────────────────────────────────────────────────┘
```

### 数据流向

```
1. 用户点击"支付"按钮
        ↓
2. 浏览器请求 https://apply.asp.cool/api/create-order
        ↓
3. Vercel 接收请求，根据 vercel.json 规则转发
        ↓
4. 请求到达腾讯云:3000/api/create-order
        ↓
5. server.js 调用支付宝 API 创建订单
        ↓
6. 支付宝返回支付链接
        ↓
7. 层层返回给浏览器，跳转到支付宝收银台
```

---

## 详细部署步骤

### 第一步：准备代码文件

#### 1.1 创建项目目录

在本地创建项目文件夹：

```bash
mkdir -p ~/Documents/ASP.cool
cd ~/Documents/ASP.cool
```

#### 1.2 创建前端文件 `index.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASP.cool - 支付宝支付</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
            width: 100%;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 10px;
        }
        .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
        }
        .plan {
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 15px;
            cursor: pointer;
            transition: all 0.3s;
        }
        .plan:hover {
            border-color: #1677ff;
            transform: translateY(-2px);
        }
        .plan.selected {
            border-color: #1677ff;
            background: #f0f7ff;
        }
        .plan-name {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
        }
        .plan-price {
            font-size: 24px;
            color: #1677ff;
            font-weight: bold;
        }
        .plan-price span {
            font-size: 14px;
            color: #999;
            font-weight: normal;
        }
        .plan-desc {
            color: #666;
            font-size: 14px;
            margin-top: 8px;
        }
        .pay-btn {
            width: 100%;
            padding: 15px;
            background: #1677ff;
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 18px;
            cursor: pointer;
            margin-top: 20px;
            transition: background 0.3s;
        }
        .pay-btn:hover {
            background: #0958d9;
        }
        .pay-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .loading {
            text-align: center;
            padding: 20px;
            color: #666;
        }
        .error {
            color: #ff4d4f;
            text-align: center;
            padding: 10px;
            background: #fff2f0;
            border-radius: 8px;
            margin-top: 15px;
        }
        .success {
            color: #52c41a;
            text-align: center;
            padding: 10px;
            background: #f6ffed;
            border-radius: 8px;
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 ASP.cool</h1>
        <p class="subtitle">选择适合您的套餐</p>
        
        <div class="plan selected" data-plan="basic" data-amount="1">
            <div class="plan-name">基础版</div>
            <div class="plan-price">¥1 <span>/ 月</span></div>
            <div class="plan-desc">适合个人开发者，包含基础功能</div>
        </div>
        
        <div class="plan" data-plan="pro" data-amount="1">
            <div class="plan-name">专业版</div>
            <div class="plan-price">¥1 <span>/ 月</span></div>
            <div class="plan-desc">适合小型团队，包含高级功能</div>
        </div>
        
        <div class="plan" data-plan="enterprise" data-amount="1">
            <div class="plan-name">企业版</div>
            <div class="plan-price">¥1 <span>/ 月</span></div>
            <div class="plan-desc">适合大型企业，包含全部功能</div>
        </div>
        
        <button class="pay-btn" id="payBtn">立即支付</button>
        <div id="message"></div>
    </div>

    <script>
        // 配置 - 使用相对路径，让 Vercel 代理
        const CONFIG = {
            apiBase: '/api'
        };

        // 选择套餐
        document.querySelectorAll('.plan').forEach(plan => {
            plan.addEventListener('click', function() {
                document.querySelectorAll('.plan').forEach(p => p.classList.remove('selected'));
                this.classList.add('selected');
            });
        });

        // 支付按钮
        document.getElementById('payBtn').addEventListener('click', async function() {
            const selected = document.querySelector('.plan.selected');
            const plan = selected.dataset.plan;
            const amount = selected.dataset.amount;
            
            const btn = this;
            const msgDiv = document.getElementById('message');
            
            btn.disabled = true;
            btn.textContent = '正在创建订单...';
            msgDiv.innerHTML = '';
            
            try {
                const response = await fetch(`${CONFIG.apiBase}/create-order`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        plan: plan,
                        amount: parseFloat(amount)
                    })
                });
                
                const data = await response.json();
                
                if (data.success && data.paymentUrl) {
                    msgDiv.innerHTML = '<div class="success">订单创建成功，正在跳转到支付宝...</div>';
                    window.location.href = data.paymentUrl;
                } else {
                    throw new Error(data.error || '创建订单失败');
                }
            } catch (error) {
                msgDiv.innerHTML = `<div class="error">支付发起失败: ${error.message}</div>`;
                btn.disabled = false;
                btn.textContent = '立即支付';
            }
        });
    </script>
</body>
</html>
```

#### 1.3 创建后端文件 `server/server.js`

```javascript
const express = require('express');
const cors = require('cors');
const AlipaySdk = require('alipay-sdk').default;

const app = express();
app.use(cors());
app.use(express.json());

// ========== 配置区域 ==========
// 正式环境配置
const ALIPAY_CONFIG = {
    appId: '2021006151671810',
    gateway: 'https://openapi.alipay.com/gateway.do',
    privateKey: require('fs').readFileSync(__dirname + '/private-key.pem', 'ascii'),
    alipayPublicKey: require('fs').readFileSync(__dirname + '/alipay-public-key.pem', 'ascii'),
    notifyUrl: 'https://apply.asp.cool/api/notify',
    returnUrl: 'https://apply.asp.cool/pay-success'
};

const alipaySdk = new AlipaySdk({
    appId: ALIPAY_CONFIG.appId,
    privateKey: ALIPAY_CONFIG.privateKey,
    alipayPublicKey: ALIPAY_CONFIG.alipayPublicKey,
    gateway: ALIPAY_CONFIG.gateway,
    signType: 'RSA2'
});

// ========== API 路由 ==========

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// 创建订单
app.post('/api/create-order', async (req, res) => {
    try {
        const { plan, amount } = req.body;
        
        if (!plan || !amount) {
            return res.status(400).json({
                success: false,
                error: '缺少必要参数'
            });
        }

        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const result = await alipaySdk.exec('alipay.trade.page.pay', {
            notify_url: ALIPAY_CONFIG.notifyUrl,
            return_url: ALIPAY_CONFIG.returnUrl,
            bizContent: {
                out_trade_no: orderId,
                total_amount: amount.toString(),
                subject: `ASP.cool ${plan}套餐`,
                product_code: 'FAST_INSTANT_TRADE_PAY'
            }
        });

        if (result && result.body) {
            res.json({
                success: true,
                orderId: orderId,
                paymentUrl: result.body
            });
        } else {
            throw new Error('支付宝返回数据异常');
        }
        
    } catch (error) {
        console.error('创建订单失败:', error);
        res.status(500).json({
            success: false,
            error: error.message || '服务器内部错误'
        });
    }
});

// 支付回调通知
app.post('/api/notify', async (req, res) => {
    try {
        const signVerified = alipaySdk.checkNotifySign(req.body);
        
        if (signVerified) {
            const { out_trade_no, trade_status } = req.body;
            console.log('支付成功:', out_trade_no, trade_status);
            // TODO: 更新订单状态到数据库
            res.send('success');
        } else {
            res.send('fail');
        }
    } catch (error) {
        console.error('回调处理失败:', error);
        res.send('fail');
    }
});

// 支付成功页面
app.get('/pay-success', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>支付成功</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }
                .success-box {
                    background: white;
                    padding: 60px;
                    border-radius: 20px;
                    text-align: center;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .icon { font-size: 80px; margin-bottom: 20px; }
                h1 { color: #52c41a; margin-bottom: 10px; }
                p { color: #666; }
                a {
                    display: inline-block;
                    margin-top: 30px;
                    padding: 12px 30px;
                    background: #1677ff;
                    color: white;
                    text-decoration: none;
                    border-radius: 8px;
                }
            </style>
        </head>
        <body>
            <div class="success-box">
                <div class="icon">✅</div>
                <h1>支付成功！</h1>
                <p>感谢您的购买，服务已激活</p>
                <a href="/">返回首页</a>
            </div>
        </body>
        </html>
    `);
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务器运行在端口 ${PORT}`);
    console.log(`📋 健康检查: http://localhost:${PORT}/api/health`);
});
```

#### 1.4 创建 `server/package.json`

```json
{
  "name": "aspcool-server",
  "version": "1.0.0",
  "description": "ASP.cool 支付服务器",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js --sandbox"
  },
  "dependencies": {
    "alipay-sdk": "^4.0.0",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  }
}
```

#### 1.5 创建 Vercel 配置文件 `vercel.json`

```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "http://124.220.79.244:3000/api/:path*"
    }
  ]
}
```

**重要**：把 `124.220.79.244` 换成你的实际服务器 IP！

---

### 第二步：部署后端到腾讯云

#### 2.1 登录服务器

```bash
ssh ubuntu@124.220.79.244
```

#### 2.2 安装 Node.js

```bash
# 更新系统
sudo apt update

# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node --version  # 应该显示 v18.x.x
npm --version
```

#### 2.3 创建项目目录

```bash
mkdir -p /home/ubuntu/aspcool/server
cd /home/ubuntu/aspcool/server
```

#### 2.4 上传代码文件

把以下文件上传到 `/home/ubuntu/aspcool/server/`：
- `server.js`
- `package.json`
- `private-key.pem` (支付宝私钥)
- `alipay-public-key.pem` (支付宝公钥)

上传方式（选一）：

**方式 A：使用 scp 命令**
```bash
# 在本地执行
scp server.js package.json private-key.pem alipay-public-key.pem ubuntu@124.220.79.244:/home/ubuntu/aspcool/server/
```

**方式 B：使用 Git**
```bash
# 在服务器上
cd /home/ubuntu/aspcool
git clone https://github.com/yourusername/aspcool.git .
```

#### 2.5 安装依赖并启动

```bash
cd /home/ubuntu/aspcool/server
npm install

# 测试启动
node server.js
```

看到 `🚀 服务器运行在端口 3000` 说明成功！

按 `Ctrl+C` 停止，接下来配置后台运行。

#### 2.6 使用 PM2 后台运行

```bash
# 安装 PM2
sudo npm install -g pm2

# 启动服务
pm2 start server.js --name aspcool

# 保存配置
pm2 save
pm2 startup

# 查看状态
pm2 status
```

#### 2.7 配置防火墙（安全组）

登录腾讯云控制台 → 云服务器 → 安全组 → 配置规则

添加以下规则：

| 类型 | 来源 | 协议端口 | 策略 |
|-----|------|---------|------|
| 自定义 | 0.0.0.0/0 | TCP:3000 | 允许 |

**为什么只开放 3000？** 因为 Vercel 会代理请求，用户不直接访问你的服务器。

#### 2.8 测试后端

```bash
# 在服务器上测试
curl http://localhost:3000/api/health

# 应该返回
{"status":"ok","time":"2024-..."}
```

---

### 第三步：部署前端到 Vercel

#### 3.1 安装 Vercel CLI

```bash
npm install -g vercel
```

#### 3.2 登录 Vercel

```bash
vercel login
```

按提示完成浏览器授权。

#### 3.3 部署项目

```bash
cd ~/Documents/ASP.cool

# 部署
vercel --prod
```

按提示操作：
- Set up and deploy? **Y**
- Which scope? 选择你的账号
- Link to existing project? **N**
- What's your project name? **apply-asp-cool**

#### 3.4 配置自定义域名

部署完成后，在 Vercel 控制台：

1. 进入项目 → Settings → Domains
2. 添加域名：`apply.asp.cool`
3. 按提示配置 DNS

#### 3.5 配置阿里云 DNS

登录阿里云控制台 → 域名解析 → apply.asp.cool

添加/修改记录：

| 记录类型 | 主机记录 | 记录值 |
|---------|---------|--------|
| A | @ | 76.76.21.21 |

**注意**：Vercel 的 IP 可能会变，以 Vercel 控制台显示的为准。

---

### 第四步：配置支付宝

#### 4.1 登录支付宝开放平台

访问：https://open.alipay.com

#### 4.2 创建应用（如果还没创建）

1. 控制台 → 网页&移动应用 → 创建应用
2. 选择「网页应用」
3. 填写应用名称：ASP.cool
4. 绑定应用主页：`https://apply.asp.cool`

#### 4.3 配置关键参数

| 参数 | 值 | 说明 |
|-----|---|------|
| 应用网关 | 不填 | 我们用不到 |
| 授权回调地址 | `https://apply.asp.cool/pay-success` | 支付成功后跳转 |
| 接口加签方式 | RSA2 | 选择 RSA2 密钥 |

#### 4.4 上传公钥

1. 工具 → 密钥工具 → 生成密钥
2. 选择 RSA2、PKCS8 格式
3. 复制「应用公钥」到支付宝后台
4. 保存「应用私钥」到 `private-key.pem`
5. 保存支付宝的「公钥」到 `alipay-public-key.pem`

#### 4.5 开通「电脑网站支付」能力

1. 应用详情 → 能力列表
2. 添加能力 → 支付能力 → 电脑网站支付
3. 提交审核（一般 1-2 个工作日）

---

### 第五步：测试支付流程

#### 5.1 检查各环节

```bash
# 1. 检查后端是否运行
ssh ubuntu@124.220.79.244 "pm2 status"

# 2. 检查后端接口
curl http://124.220.79.244:3000/api/health

# 3. 检查 Vercel 部署
vercel --version
```

#### 5.2 浏览器测试

1. 访问 `https://apply.asp.cool`
2. 打开开发者工具（F12）→ Network 标签
3. 选择一个套餐，点击「立即支付」
4. 观察网络请求：
   - 应该有 `create-order` 请求
   - 状态码应该是 200
   - 返回数据应该有 `paymentUrl`

#### 5.3 常见问题

| 问题 | 原因 | 解决 |
|-----|------|------|
| 405 Method Not Allowed | Vercel 没配置 rewrite | 检查 `vercel.json` |
| 无法连接到服务器 | 安全组没开 3000 | 腾讯云控制台添加规则 |
| 支付页面报错 | 支付宝配置错误 | 检查 appId 和密钥 |
| 回调失败 | 回调地址不对 | 检查支付宝后台配置 |

---

## 故障排查

### 问题 1：Vercel 部署后 404

**症状**：访问 `https://apply.asp.cool` 显示 404

**排查**：
```bash
# 检查 vercel.json 是否存在
cat vercel.json

# 重新部署
vercel --prod
```

### 问题 2：API 请求超时

**症状**：点击支付后一直转圈

**排查**：
```bash
# 在服务器上检查
pm2 logs aspcool

# 检查端口是否监听
netstat -tlnp | grep 3000
```

### 问题 3：支付宝报错 " insufficient permissions"

**症状**：创建订单时支付宝返回权限不足

**解决**：
1. 检查应用是否审核通过
2. 检查是否签约「电脑网站支付」
3. 检查 appId 是否正确

### 问题 4：支付成功但没收到回调

**症状**：用户付完钱，系统没更新状态

**排查**：
```bash
# 查看服务器日志
pm2 logs aspcool

# 检查 notifyUrl 是否可访问
curl -X POST https://apply.asp.cool/api/notify
```

---

## 总结

### 部署检查清单

- [ ] 后端代码上传到 `/home/ubuntu/aspcool/server/`
- [ ] 密钥文件放置正确
- [ ] `npm install` 执行成功
- [ ] PM2 启动并运行
- [ ] 安全组开放 3000 端口
- [ ] 前端代码部署到 Vercel
- [ ] `vercel.json` 配置正确
- [ ] DNS 指向 Vercel
- [ ] 支付宝应用审核通过
- [ ] 回调地址配置正确

### 关键文件位置

| 文件 | 位置 | 说明 |
|-----|------|------|
| index.html | Vercel | 前端页面 |
| vercel.json | Vercel | 反向代理配置 |
| server.js | 腾讯云 | 后端 API |
| private-key.pem | 腾讯云 | 支付宝私钥 |
| alipay-public-key.pem | 腾讯云 | 支付宝公钥 |

---

**文档版本**：v1.0  
**最后更新**：2024年 -->
