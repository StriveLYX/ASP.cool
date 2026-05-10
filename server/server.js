/**
 * ASP.Cool 支付后端服务
 * 支付宝电脑网站支付 (alipay.trade.page.pay)
 *
 * 使用前请先完成以下配置：
 * 1. 在支付宝开放平台创建"网页/移动应用"
 * 2. 获取 APPID
 * 3. 生成 RSA2 密钥对，在开放平台配置公钥
 * 4. 将应用私钥保存到 private-key.pem
 * 5. 将支付宝公钥保存到 alipay-public-key.pem
 *
 * 沙箱测试：
 *   node server.js --sandbox
 *   沙箱环境地址：https://openapi-sandbox.dl.alipaydev.com/gateway.do
 */

const express = require('express');
const { AlipaySdk } = require('alipay-sdk');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 配置区域 - 请替换为您的真实配置
// ==========================================
const isSandbox = process.argv.includes('--sandbox');

// ==========================================
// 密钥文件路径（沙箱和正式环境分离）
// ==========================================
const KEY_DIR = __dirname;
const privateKeyFile = isSandbox
    ? path.join(KEY_DIR, 'sandbox-private-key.pem')
    : path.join(KEY_DIR, 'private-key.pem');
const alipayPublicKeyFile = isSandbox
    ? path.join(KEY_DIR, 'sandbox-alipay-public-key.pem')
    : path.join(KEY_DIR, 'alipay-public-key.pem');

const ALIPAY_CONFIG = {
    // 应用 AppID（从支付宝开放平台获取）
    appId: isSandbox
        ? '9021000163651842'        // 沙箱 AppID
        : '2021006151671810',      // 正式环境 AppID

    // 支付宝网关地址
    gateway: isSandbox
        ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
        : 'https://openapi.alipay.com/gateway.do',

    // 应用私钥（仅保存在服务端，绝对不能泄露）
    privateKey: fs.readFileSync(privateKeyFile, 'utf-8').toString(),

    // 支付宝公钥（用于验签）
    alipayPublicKey: fs.readFileSync(alipayPublicKeyFile, 'utf-8').toString(),

    // 签名算法（推荐 RSA2）
    signType: 'RSA2',

    // 异步通知地址（支付宝支付完成后通知此地址）
    // 注意：必须外网可访问的 HTTPS 地址
    notifyUrl: isSandbox
        ? 'http://localhost:3000/api/alipay/notify'
        : 'https://apply.asp.cool/api/alipay/notify',

    // 支付完成后的跳转地址（用户支付完成后浏览器跳转回来）
    returnUrl: isSandbox
        ? 'http://localhost:3000/index.html?payResult=success'
        : 'https://apply.asp.cool/index.html?payResult=success',
};

// 会员方案定价（单位：元）
const PLANS = {
    basic:    { name: '基础版', monthly: 1,  yearly: 1  },
    pro:      { name: '专业版', monthly: 1, yearly: 1 },
    ultimate: { name: '旗舰版', monthly: 1, yearly: 1 }
};

// 初始化支付宝 SDK
let alipaySdk;
try {
    alipaySdk = new AlipaySdk({
        appId: ALIPAY_CONFIG.appId,
        privateKey: ALIPAY_CONFIG.privateKey,
        alipayPublicKey: ALIPAY_CONFIG.alipayPublicKey,
        gateway: ALIPAY_CONFIG.gateway,
        signType: ALIPAY_CONFIG.signType,
    });
    console.log('✅ 支付宝 SDK 初始化成功');
    console.log('   环境:', isSandbox ? '沙箱' : '正式');
    console.log('   AppID:', ALIPAY_CONFIG.appId);
} catch (err) {
    console.error('❌ 支付宝 SDK 初始化失败:', err.message);
    console.error('   请确保密钥文件存在且格式正确');
}

// 内存存储订单（生产环境请使用数据库）
const orders = new Map();

// ==========================================
// 接口 1: 创建支付宝支付订单
// POST /api/alipay/pay
// ==========================================
app.post('/api/alipay/pay', async (req, res) => {
    try {
        const { orderId, plan, billing } = req.body;

        // 参数校验
        if (!orderId || !plan || !billing) {
            return res.status(400).json({ error: '缺少必要参数: orderId, plan, billing' });
        }

        if (!PLANS[plan]) {
            return res.status(400).json({ error: '无效的会员方案: ' + plan });
        }

        if (!['monthly', 'yearly'].includes(billing)) {
            return res.status(400).json({ error: '无效的计费方式: ' + billing });
        }

        const planInfo = PLANS[plan];
        const amount = planInfo[billing]; // 金额（元）
        const subject = 'ASP.Cool ' + planInfo.name + ' - ' + (billing === 'monthly' ? '月付' : '年付');

        console.log('📦 创建支付订单:', { orderId, plan, billing, amount: amount + '元', subject });

        // 调用支付宝 alipay.trade.page.pay 接口
        // 电脑网站支付：生成表单 HTML，前端自动提交跳转到支付宝收银台
        const result = await alipaySdk.pageExec('alipay.trade.page.pay', {
            notifyUrl: ALIPAY_CONFIG.notifyUrl,
            returnUrl: ALIPAY_CONFIG.returnUrl,
            bizContent: {
                out_trade_no: orderId,           // 商户订单号（唯一）
                product_code: 'FAST_INSTANT_TRADE_PAY',  // 产品码（电脑网站支付固定值）
                total_amount: amount.toFixed(2),  // 订单金额（元，精确到小数点后两位）
                subject: subject,                 // 订单标题
                body: 'ASP.Cool 设计创意课程平台会员',  // 订单描述
                // timeout_express: '30m',         // 超时关闭时间（可选）
            },
        });

        // 保存订单到内存
        orders.set(orderId, {
            orderId,
            plan,
            billing,
            amount,
            subject,
            status: 'pending',
            createdAt: new Date().toISOString(),
        });

        console.log('✅ 订单创建成功:', orderId);

        // 返回表单 HTML 给前端
        // 前端会将此 HTML 插入页面并自动提交，跳转到支付宝收银台
        res.json({
            formHtml: result,  // 完整的表单 HTML 字符串
            orderId: orderId,
            amount: amount,
        });

    } catch (err) {
        console.error('❌ 创建支付订单失败:', err.message);
        res.status(500).json({ error: '创建支付订单失败: ' + err.message });
    }
});

// ==========================================
// 接口 2: 支付宝异步通知
// POST /api/alipay/notify
// 支付宝在用户支付完成后会 POST 通知到此地址
// ==========================================
app.post('/api/alipay/notify', async (req, res) => {
    console.log('🔔 收到支付宝异步通知');
    console.log('   参数:', JSON.stringify(req.body));

    try {
        // Step 1: 验签（非常重要！确保通知来自支付宝）
        const signVerified = alipaySdk.checkNotifySign(req.body);

        if (!signVerified) {
            console.error('❌ 验签失败！通知可能不是来自支付宝');
            return res.send('fail');
        }

        console.log('✅ 验签成功');

        // Step 2: 获取通知参数
        const params = req.body;
        const orderId = params.out_trade_no;        // 商户订单号
        const tradeNo = params.trade_no;            // 支付宝交易号
        const tradeStatus = params.trade_status;    // 交易状态
        const totalAmount = params.total_amount;    // 实付金额

        console.log('   订单号:', orderId);
        console.log('   支付宝交易号:', tradeNo);
        console.log('   交易状态:', tradeStatus);
        console.log('   实付金额:', totalAmount);

        // Step 3: 检查交易状态
        if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
            // Step 4: 更新订单状态
            const order = orders.get(orderId);
            if (order && order.status !== 'paid') {
                order.status = 'paid';
                order.tradeNo = tradeNo;
                order.paidAt = new Date().toISOString();
                order.totalAmount = totalAmount;
                orders.set(orderId, order);

                // TODO: 在这里执行您的业务逻辑
                // 例如：开通会员、发送确认邮件、记录日志等
                console.log('🎉 支付成功！订单:', orderId, '方案:', order.plan);

                // 示例：开通会员
                // await activateUserMembership(order);
            } else if (order && order.status === 'paid') {
                console.log('   订单已处理过，跳过（幂等处理）');
            } else {
                console.warn('   未找到订单:', orderId);
            }
        }

        // Step 5: 返回 success 给支付宝（必须返回纯文本 "success"）
        res.send('success');

    } catch (err) {
        console.error('❌ 处理异步通知失败:', err.message);
        res.send('fail');
    }
});

// ==========================================
// 接口 3: 查询订单状态
// GET /api/order/:orderId
// ==========================================
app.get('/api/order/:orderId', (req, res) => {
    const order = orders.get(req.params.orderId);
    if (!order) {
        return res.status(404).json({ error: '订单不存在' });
    }
    res.json(order);
});

// ==========================================
// 接口 4: 支付结果页面查询
// GET /api/pay/result?orderId=xxx
// 用户从支付宝跳转回来后，前端调用此接口查询支付结果
// ==========================================
app.get('/api/pay/result', async (req, res) => {
    const { orderId } = req.query;

    if (!orderId) {
        return res.status(400).json({ error: '缺少 orderId 参数' });
    }

    try {
        // 调用支付宝交易查询接口确认支付结果
        const result = await alipaySdk.exec('alipay.trade.query', {
            bizContent: {
                out_trade_no: orderId,
            },
        });

        console.log('📋 查询订单结果:', orderId, JSON.stringify(result));

        if (result.code === '10000' && result.tradeStatus === 'TRADE_SUCCESS') {
            // 更新本地订单状态
            const order = orders.get(orderId);
            if (order) {
                order.status = 'paid';
                order.tradeNo = result.tradeNo;
                order.paidAt = new Date().toISOString();
                orders.set(orderId, order);
            }
            res.json({ status: 'paid', orderId, tradeNo: result.tradeNo });
        } else if (result.code === '10000' && result.tradeStatus === 'WAIT_BUYER_PAY') {
            res.json({ status: 'pending', orderId });
        } else {
            res.json({ status: 'failed', orderId, message: result.subMsg || '查询失败' });
        }
    } catch (err) {
        console.error('❌ 查询订单失败:', err.message);
        res.status(500).json({ error: '查询订单失败: ' + err.message });
    }
});

// ==========================================
// 接口 5: 前端支付结果通知（备用）
// POST /api/payment/notify
// ==========================================
app.post('/api/payment/notify', (req, res) => {
    const { orderId, method, status, plan, billing } = req.body;
    console.log('📨 前端支付结果通知:', { orderId, method, status, plan, billing });

    // 注意：前台跳转结果不可信，应以异步通知或主动查询为准
    // 此接口仅用于日志记录
    res.json({ received: true });
});

// ==========================================
// 静态文件服务（提供 index.html）
// ==========================================
app.use(express.static(path.join(__dirname, '..')));

// ==========================================
// 启动服务
// ==========================================
const PORT = 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ASP.Cool 支付服务已启动');
    console.log('   地址: http://localhost:' + PORT);
    console.log('   环境:', isSandbox ? '沙箱' : '正式');
    console.log('');
    console.log('📋 可用接口:');
    console.log('   POST /api/alipay/pay      - 创建支付宝支付订单');
    console.log('   POST /api/alipay/notify   - 支付宝异步通知回调');
    console.log('   GET  /api/order/:orderId   - 查询订单状态');
    console.log('   GET  /api/pay/result       - 查询支付结果');
    console.log('');
    if (isSandbox) {
        console.log('⚠️  当前为沙箱环境');
        console.log('   沙箱买家账号请登录支付宝开放平台查看');
    } else {
        console.log('⚠️  当前为正式环境，请确保配置正确');
    }
    console.log('');
});
