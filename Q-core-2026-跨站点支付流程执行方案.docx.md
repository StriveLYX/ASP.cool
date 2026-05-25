# Q-core 2026 跨站点支付流程执行方案

## 一、现状分析

### 1.1 已完成部分 ✅

| 组件 | 状态 | 说明 |
|------|------|------|
| camp26.asp.cool 前端 | ✅ | 登录/注册页面、申请问卷页面 |
| camp2026.asp.cool 后端 | ✅ | 用户认证API、申请管理API、管理后台API |
| 数据库 | ✅ | PostgreSQL，users表、qcore_applications表 |
| 邮件服务 | ✅ | Resend集成，支持验证邮件、审核通知邮件 |
| 管理后台 | ✅ | admin.html，支持申请审核、支付确认 |

### 1.2 待完成部分 ⏳

| 组件 | 状态 | 说明 |
|------|------|------|
| apply.asp.cool 支付站 | ⏳ | 需要共享用户数据库，实现跨站登录 |
| 支付功能 | ⏳ | 四档定价、人数限制、支付状态同步 |
| 跨站单点登录 | ⏳ | JWT token传递，用户无感知跳转 |
| 支付完成回调 | ⏳ | 跳转回camp26并显示支付状态 |

---

## 二、系统架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  camp26.asp.cool │     │  camp2026.asp.cool│     │  apply.asp.cool │
│  (EdgeOne Pages) │────▶│  (BaoTa+Nginx)   │◀────│  (支付站点)      │
│  前端展示+问卷    │     │  Node.js API     │     │  支付+订单       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
           │                       │                       │
           └───────────────────────┼───────────────────────┘
                                   ▼
                    ┌─────────────────────────┐
                    │   PostgreSQL (腾讯云)    │
                    │   - users表 (共享)       │
                    │   - qcore_applications   │
                    │   - payments (新建)      │
                    └─────────────────────────┘
```

---

## 三、核心流程设计

### 3.1 完整用户旅程

```
用户访问 camp26.asp.cool/apply.html
        │
        ▼
┌───────────────┐
│  登录/注册账号  │◀─────────────────────────────┐
└───────────────┘                              │
        │                                      │
        ▼                                      │
┌───────────────┐     ┌───────────────┐       │
│  填写申请问卷   │────▶│ 提交申请      │       │
└───────────────┘     └───────────────┘       │
                              │                │
                              ▼                │
                    ┌───────────────┐          │
                    │ 状态: pending │          │
                    └───────────────┘          │
                              │                │
                              ▼                │
                    ┌───────────────┐          │
                    │ 管理员审核     │          │
                    └───────────────┘          │
                              │                │
            ┌─────────────────┼─────────────────┘
            ▼                 ▼
    ┌───────────┐      ┌───────────┐
    │ 审核通过   │      │ 审核拒绝   │
    └───────────┘      └───────────┘
         │                  │
         ▼                  ▼
    ┌───────────┐      ┌───────────┐
    │发送支付邮件 │      │发送拒绝邮件 │
    │含支付链接  │      │           │
    └───────────┘      └───────────┘
         │
         ▼
用户点击邮件中的支付链接
         │
         ▼
┌─────────────────────────┐
│ https://apply.asp.cool/  │
│ ?token=xxx&app_id=xxx   │
└─────────────────────────┘
         │
         ▼
┌───────────────┐
│  自动登录      │
│ (JWT验证)     │
└───────────────┘
         │
         ▼
┌───────────────┐     ┌───────────────┐
│  显示支付页面  │────▶│  选择支付档位  │
└───────────────┘     └───────────────┘
                              │
                              ▼
                    ┌───────────────┐
                    │  完成支付     │
                    └───────────────┘
                              │
                              ▼
                    ┌───────────────┐
                    │  更新支付状态  │
                    │  发送欢迎邮件  │
                    └───────────────┘
                              │
                              ▼
                    ┌───────────────┐
                    │  跳转回camp26  │
                    │  /index.html   │
                    │  ?paid=success │
                    └───────────────┘
```

---

## 四、数据库设计

### 4.1 新建 payments 表

```sql
-- 支付订单表
CREATE TABLE qcore_payments (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES qcore_applications(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    
    -- 支付档位
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('early_bird', 'second_batch', 'third_batch', 'regular')),
    amount DECIMAL(10,2) NOT NULL,
    
    -- 支付状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    
    -- 支付渠道信息
    payment_method VARCHAR(50),
    payment_channel VARCHAR(50), -- alipay, wechat_pay
    transaction_id VARCHAR(100),
    paid_at TIMESTAMP WITH TIME ZONE,
    
    -- 限额控制
    batch_number INTEGER NOT NULL, -- 批次号，用于控制人数
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_payments_app_id ON qcore_payments(application_id);
CREATE INDEX idx_payments_user_id ON qcore_payments(user_id);
CREATE INDEX idx_payments_status ON qcore_payments(status);
CREATE INDEX idx_payments_tier ON qcore_payments(tier);
CREATE INDEX idx_payments_batch ON qcore_payments(batch_number);

-- 支付批次配置表（用于动态调整限额）
CREATE TABLE qcore_payment_tiers (
    tier VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    max_slots INTEGER NOT NULL,
    current_slots INTEGER NOT NULL DEFAULT 0,
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 初始化四档定价
INSERT INTO qcore_payment_tiers (tier, name, amount, max_slots) VALUES
('early_bird', '早鸟价', 9800.00, 30),
('second_batch', '第二批', 11800.00, 60),
('third_batch', '第三批', 13800.00, 100),
('regular', '原价', 15800.00, 999999);
```

---

## 五、API 设计

### 5.1 camp2026.asp.cool 新增 API

```javascript
// 1. 生成支付链接（审核通过后调用）
POST /api/applications/:id/payment-link
请求: { tier: 'early_bird' }
响应: { 
  success: true, 
  data: { 
    paymentUrl: 'https://apply.asp.cool/?token=xxx&app_id=xxx&tier=early_bird',
    expiresAt: '2026-06-01T00:00:00Z'
  }
}

// 2. 验证支付 token（apply.asp.cool 调用）
GET /api/auth/verify-token?token=xxx
响应: { success: true, data: { user: {...}, application: {...} } }

// 3. 支付回调（apply.asp.cool 支付完成后调用）
POST /api/payments/callback
请求: { 
  application_id: 123,
  payment_id: 456,
  status: 'paid',
  transaction_id: 'xxx'
}
响应: { success: true }

// 4. 查询支付状态
GET /api/applications/:id/payment-status
响应: { success: true, data: { status: 'paid', tier: 'early_bird', paid_at: '...' } }
```

### 5.2 apply.asp.cool 支付站 API

```javascript
// 1. 获取当前可用档位
GET /api/tiers/available
响应: {
  success: true,
  data: [
    { tier: 'early_bird', name: '早鸟价', amount: 9800, remaining: 15 },
    { tier: 'second_batch', name: '第二批', amount: 11800, remaining: 60 }
  ]
}

// 2. 创建支付订单
POST /api/payments/create
请求: { application_id: 123, tier: 'early_bird' }
响应: { success: true, data: { payment_id: 456, pay_url: '...' } }

// 3. 支付回调处理（支付宝/微信）
POST /api/payments/notify/:channel
处理支付结果，回调 camp2026 更新状态

// 4. 支付页面初始化
GET /api/payments/page-init?token=xxx&app_id=xxx
响应: { user: {...}, application: {...}, available_tiers: [...] }
```

---

## 六、跨站单点登录 (SSO)

### 6.1 Token 传递机制

```javascript
// camp26.asp.cool 生成支付跳转链接
function generatePaymentLink(applicationId, tier) {
  const token = jwt.sign(
    { 
      userId: user.id, 
      email: user.email,
      applicationId: applicationId,
      tier: tier,
      purpose: 'payment',
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24小时过期
    },
    process.env.JWT_SECRET // 两个站点使用相同的 JWT_SECRET
  );
  
  return `https://apply.asp.cool/?token=${token}&app_id=${applicationId}&tier=${tier}`;
}
```

### 6.2 apply.asp.cool 验证流程

```javascript
// 页面加载时验证 token
async function verifyToken(token) {
  try {
    // 调用 camp2026 API 验证
    const response = await fetch('https://camp2026.asp.cool/api/auth/verify-token?token=' + token);
    const data = await response.json();
    
    if (data.success) {
      // 验证通过，自动登录
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(data.data.user));
      return data.data;
    }
  } catch (error) {
    // Token 无效或过期，跳转到登录页
    window.location.href = 'https://camp26.asp.cool/apply.html?redirect=payment';
  }
}
```

---

## 七、邮件模板更新

### 7.1 审核通过邮件（含支付链接）

```javascript
// utils/email.js 新增
const sendApprovalWithPaymentEmail = async (email, name, applicationId) => {
  // 获取可用档位
  const tiers = await getAvailableTiers();
  
  // 生成支付链接（不带具体档位，让用户自己选择）
  const paymentUrl = generatePaymentLink(applicationId, null);
  
  const html = `
    <div class="container">
      <div class="header">
        <div class="logo">ASP.cool</div>
        <h1>申请已通过</h1>
      </div>
      <div class="content">
        <h2>恭喜您，${name}！</h2>
        <p>您的 Q-core 2026 申请已通过审核。</p>
        
        <div class="status-box success">
          <h3>✓ 审核通过</h3>
        </div>
        
        <h3>可选支付档位：</h3>
        <table style="width:100%;margin:20px 0;">
          <tr style="background:#f8f9fa;">
            <td style="padding:12px;"><strong>🔥 早鸟价</strong></td>
            <td style="padding:12px;">¥9,800</td>
            <td style="padding:12px;">限前30人</td>
            <td style="padding:12px;">剩余 ${tiers.early_bird.remaining} 位</td>
          </tr>
          <tr>
            <td style="padding:12px;"><strong>第二批</strong></td>
            <td style="padding:12px;">¥11,800</td>
            <td style="padding:12px;">限60人</td>
            <td style="padding:12px;">剩余 ${tiers.second_batch.remaining} 位</td>
          </tr>
          <tr style="background:#f8f9fa;">
            <td style="padding:12px;"><strong>第三批</strong></td>
            <td style="padding:12px;">¥13,800</td>
            <td style="padding:12px;">限100人</td>
            <td style="padding:12px;">剩余 ${tiers.third_batch.remaining} 位</td>
          </tr>
          <tr>
            <td style="padding:12px;"><strong>原价</strong></td>
            <td style="padding:12px;">¥15,800</td>
            <td style="padding:12px;">不限</td>
            <td style="padding:12px;">-</td>
          </tr>
        </table>
        
        <center>
          <a href="${paymentUrl}" class="button">立即支付</a>
        </center>
        
        <p style="font-size:13px;color:#999;">
          支付链接24小时内有效。早鸟价名额有限，建议尽快完成支付。<br>
          如有疑问请联系：vannifaye@asp.cool
        </p>
      </div>
      ${emailFooter}
    </div>
  `;
  
  await resend.emails.send({...});
};
```

---

## 八、执行步骤

### Phase 1: 数据库更新（1天）

```bash
# 1. 在服务器执行 SQL
sudo -u postgres psql -d asp_auth -f setup_payments.sql

# 2. 验证表创建
sudo -u postgres psql -d asp_auth -c "\dt"
```

### Phase 2: camp2026 后端更新（2天）

1. 新增 payments.js 路由
2. 更新 email.js 添加支付邮件
3. 更新 admin.js 审核通过后发送支付邮件
4. 部署并测试

### Phase 3: apply.asp.cool 搭建（3天）

1. 创建新站点（BaoTa 或 EdgeOne Pages）
2. 配置共享 JWT_SECRET 和数据库连接
3. 开发支付页面（选择档位、支付表单）
4. 集成支付宝/微信支付 SDK
5. 实现支付回调和状态同步

### Phase 4: 联调测试（2天）

1. 测试跨站登录流程
2. 测试支付完整流程
3. 测试人数限制逻辑
4. 测试支付完成回调

### Phase 5: 上线部署（1天）

1. 配置生产环境支付密钥
2. 更新邮件模板
3. 监控和日志配置

---

## 九、关键配置

### 9.1 环境变量（apply.asp.cool）

```bash
# 数据库（与 camp2026 共享）
DB_HOST=localhost
DB_PORT=5432
DB_NAME=asp_auth
DB_USER=asp_admin
DB_PASSWORD=xxx

# JWT（必须与 camp2026 完全一致）
JWT_SECRET=your_shared_secret_key

# 支付渠道
ALIPAY_APP_ID=xxx
ALIPAY_PRIVATE_KEY=xxx
ALIPAY_PUBLIC_KEY=xxx
WECHAT_PAY_MCH_ID=xxx
WECHAT_PAY_API_KEY=xxx

# Resend 邮件
RESEND_API_KEY=xxx
FROM_EMAIL=onboarding@resend.dev
FROM_NAME=ASP.cool

# 跨域
FRONTEND_URL=https://camp26.asp.cool
PAYMENT_SITE_URL=https://apply.asp.cool
```

### 9.2 Nginx 配置（apply.asp.cool）

```nginx
server {
    listen 80;
    server_name apply.asp.cool;
    
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 十、人数限制逻辑

```javascript
// 获取可用档位（自动计算剩余名额）
async function getAvailableTiers() {
  const tiers = await db.query(`
    SELECT t.*, 
           t.max_slots - COUNT(p.id) as remaining
    FROM qcore_payment_tiers t
    LEFT JOIN qcore_payments p ON p.tier = t.tier AND p.status = 'paid'
    WHERE t.is_active = true
    GROUP BY t.tier
    ORDER BY t.amount ASC
  `);
  
  return tiers.rows.map(t => ({
    tier: t.tier,
    name: t.name,
    amount: t.amount,
    remaining: Math.max(0, t.remaining),
    available: t.remaining > 0
  }));
}

// 创建支付订单时检查名额
async function createPaymentOrder(userId, applicationId, tier) {
  // 检查档位是否还有名额
  const tierInfo = await db.query(
    `SELECT max_slots - COUNT(p.id) as remaining
     FROM qcore_payment_tiers t
     LEFT JOIN qcore_payments p ON p.tier = t.tier AND p.status = 'paid'
     WHERE t.tier = $1
     GROUP BY t.tier, t.max_slots`,
    [tier]
  );
  
  if (tierInfo.rows[0].remaining <= 0) {
    throw new Error('该档位已满，请选择其他档位');
  }
  
  // 创建订单...
}
```

---

## 十一、支付完成回调流程

```javascript
// apply.asp.cool 支付成功后
async function onPaymentSuccess(paymentId, transactionId) {
  // 1. 更新本地支付状态
  await db.query(
    `UPDATE qcore_payments SET status = 'paid', transaction_id = $1, paid_at = NOW() WHERE id = $2`,
    [transactionId, paymentId]
  );
  
  // 2. 回调 camp2026 更新申请状态
  await fetch('https://camp2026.asp.cool/api/payments/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      application_id: applicationId,
      payment_id: paymentId,
      status: 'paid',
      transaction_id: transactionId
    })
  });
  
  // 3. 发送欢迎邮件
  await sendWelcomeEmail(userEmail, userName);
  
  // 4. 跳转回 camp26
  return `https://camp26.asp.cool/index.html?payment=success&app_id=${applicationId}`;
}
```

---

## 十二、风险与应对

| 风险 | 应对方案 |
|------|----------|
| 并发超卖 | 数据库事务 + 唯一索引 + 乐观锁 |
| 支付回调丢失 | 定时任务补偿 + 手动查询接口 |
| Token 泄露 | 短有效期(24h) + 单次使用 + HTTPS |
| 跨域问题 | CORS 白名单 + 预检请求 |
| 支付渠道故障 | 多渠道备份(支付宝+微信) |

---

## 十三、后续优化建议

1. **退款功能**：管理员后台支持退款操作
2. **发票管理**：电子发票申请和开具
3. **分期支付**：支持 2-3 期分期付款
4. **优惠券系统**：支持早鸟码、推荐码等
5. **支付统计**：营收报表、转化率分析

---

**文档生成时间**: 2026-05-25
**版本**: v1.0
