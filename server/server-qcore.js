/**
 * Q-core 2026 支付后端服务,专业版本
 * 支持跨站单点登录、选择性支付、档位人数限制
 * 
 * 功能：
 * 1. JWT Token 验证（跨站登录）
 * 2. 四档定价查询（早鸟/第二批/第三批/原价）
 * 3. 人数限制控制
 * 4. 支付宝支付集成
 * 5. 支付完成回调 camp2026
 */

const express = require('express');
const { AlipaySdk } = require('alipay-sdk');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 加载 .env 环境变量（必须在其他模块之前）
require('dotenv').config({ path: path.join(__dirname, '.env') });

const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();

// ==========================================
// 数据库配置（与 camp2026 共享）
// ==========================================
// 支持 DATABASE_URL 或分开的配置
const dbConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'asp_auth',
        user: process.env.DB_USER || 'asp_admin',
        password: process.env.DB_PASSWORD || undefined,
    };

const pool = new Pool(dbConfig);

// 测试数据库连接
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ 数据库连接失败:', err.message);
        console.log('   请检查数据库配置，将使用内存模式运行');
    } else {
        console.log('✅ 数据库连接成功');
        release();
    }
});

// ==========================================
// JWT 配置（必须与 camp2026 一致）
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET || 'your-shared-secret-key';
const CAMP2026_API = process.env.CAMP2026_API || 'https://camp2026.asp.cool';

// ==========================================
// CORS 配置
// ==========================================
const ALLOWED_ORIGINS = new Set([
    'https://apply.asp.cool',
    'https://camp26.asp.cool',
    'https://camp2026.asp.cool',
    'http://localhost:3000',
    'http://localhost:5173',
]);

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 支付宝配置
// ==========================================
const isSandbox = process.argv.includes('--sandbox');
const KEY_DIR = __dirname;
const privateKeyFile = isSandbox
    ? path.join(KEY_DIR, 'sandbox-private-key.pem')
    : path.join(KEY_DIR, 'private-key.pem');
const alipayPublicKeyFile = isSandbox
    ? path.join(KEY_DIR, 'sandbox-alipay-public-key.pem')
    : path.join(KEY_DIR, 'alipay-public-key.pem');

const ALIPAY_CONFIG = {
    appId: isSandbox ? '9021000163651842' : '2021006152636876',
    gateway: isSandbox 
        ? 'https://openapi.alipaydev.com/gateway.do'
        : 'https://openapi.alipay.com/gateway.do',
    privateKey: fs.readFileSync(privateKeyFile, 'utf-8').toString(),
    alipayPublicKey: fs.readFileSync(alipayPublicKeyFile, 'utf-8').toString(),
    signType: 'RSA2',
    notifyUrl: isSandbox
        ? 'http://localhost:3000/api/alipay/notify'
        : 'https://api.asp.cool/api/alipay/notify',
    returnUrl: isSandbox
        ? 'http://localhost:3000/payment-result.html'
        : 'https://api.asp.cool/payment-result.html',
};

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
} catch (err) {
    console.error('❌ 支付宝 SDK 初始化失败:', err.message);
}

// ==========================================
// JWT 验证中间件
// ==========================================
function verifyToken(req, res, next) {
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: '缺少 token' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error('Token 验证失败:', err.message);
        return res.status(401).json({ error: 'token 无效或已过期' });
    }
}

// ==========================================
// 数据库查询辅助函数
// ==========================================
async function query(text, params) {
    try {
        const result = await pool.query(text, params);
        return result;
    } catch (err) {
        console.error('数据库查询错误:', err.message);
        throw err;
    }
}

// ==========================================
// API 1: 验证 Token 并获取用户信息
// GET /api/auth/verify?token=xxx
// ==========================================
app.get('/api/auth/verify', async (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).json({ success: false, error: '缺少 token' });
    }
    
    try {
        // 验证 JWT
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 从数据库获取用户信息
        const userResult = await query(
            'SELECT id, email, full_name, created_at FROM users WHERE id = $1',
            [decoded.userId]
            
        );
        //
        console.log('✅ 数据库查询用户成功:', userResult.rows[0]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: '用户不存在' });
        }
        
        const user = userResult.rows[0];
        
        
        // 获取申请信息
        const appResult = await query(
            'SELECT * FROM qcore_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [user.id]
        );
        console.log('✅ 数据库查询申请成功:', appResult.rows[0]);
        
        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.full_name,
                },
                application: appResult.rows[0] || null,
            }
        });
        
    } catch (err) {
        console.error('验证失败:', err.message);
        res.status(401).json({ success: false, error: 'token 无效或已过期' });
    }
});

// ==========================================
// API: 获取当前用户最新申请
// GET /api/applications/mine
// ==========================================
app.get('/api/applications/mine', verifyToken, async (req, res) => {
    try {
        const result = await query(
            'SELECT id, user_id, status, full_name, paid_at, created_at, updated_at FROM qcore_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.userId]
        );

        if (result.rows.length > 0) {
            res.json({
                success: true,
                data: result.rows[0]
            });
        } else {
            res.json({
                success: false,
                error: '暂无申请记录'
            });
        }
    } catch (err) {
        console.error('获取申请记录失败:', err.message);
        res.status(500).json({ success: false, error: '获取申请记录失败' });
    }
});

// ==========================================
// API 2: 获取可用档位（带人数限制）
// GET /api/tiers/available
// ==========================================
app.get('/api/tiers/available', async (req, res) => {
    try {
        const result = await query(`
            SELECT 
                t.tier,
                t.name,
                t.amount,
                t.max_slots,
                GREATEST(t.max_slots - COUNT(p.id), 0) as remaining,
                t.max_slots - GREATEST(t.max_slots - COUNT(p.id), 0) as sold,
                t.is_active
            FROM qcore_payment_tiers t
            LEFT JOIN qcore_payments p ON p.tier = t.tier AND p.status = 'paid'
            WHERE t.is_active = true
            GROUP BY t.tier, t.name, t.amount, t.max_slots, t.is_active
            ORDER BY t.amount ASC
        `);
        
        const tiers = result.rows.map(t => ({
            tier: t.tier,
            name: t.name,
            amount: parseFloat(t.amount),
            maxSlots: t.max_slots,
            remaining: parseInt(t.remaining),
            sold: parseInt(t.sold),
            available: t.remaining > 0 && t.is_active,
        }));
        
        res.json({ success: true, data: tiers });
        
    } catch (err) {
        console.error('获取档位失败:', err.message);
        res.status(500).json({ success: false, error: '获取档位失败' });
    }
});

// ==========================================
// API 3: 支付页面初始化
// GET /api/payments/page-init?token=xxx&app_id=xxx
// ==========================================
app.get('/api/payments/page-init', async (req, res) => {
    const { token, app_id } = req.query;
    
    if (!token || !app_id) {
        return res.status(400).json({ 
            success: false, 
            error: '缺少必要参数: token, app_id' 
        });
    }
    
    try {
        // 验证 token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 并行查询用户、申请、档位信息
        const [userResult, appResult, tiersResult] = await Promise.all([
            query('SELECT id, email, name FROM users WHERE id = $1', [decoded.userId]),
            query('SELECT id, user_id, status, full_name, paid_at, created_at, updated_at FROM qcore_applications WHERE id = $1 AND user_id = $2', [app_id, decoded.userId]),
            query(`
                SELECT 
                    t.tier, t.name, t.amount, t.max_slots,
                    GREATEST(t.max_slots - COUNT(p.id), 0) as remaining,
                    t.is_active
                FROM qcore_payment_tiers t
                LEFT JOIN qcore_payments p ON p.tier = t.tier AND p.status = 'paid'
                WHERE t.is_active = true
                GROUP BY t.tier, t.name, t.amount, t.max_slots, t.is_active
                ORDER BY t.amount ASC
            `)
        ]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: '用户不存在' });
        }
        
        if (appResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: '申请不存在' });
        }
        
        const application = appResult.rows[0];
        
        // 检查是否已支付
        const existingPayment = await query(
            'SELECT * FROM qcore_payments WHERE application_id = $1 AND status = $2',
            [app_id, 'paid']
        );
        
        if (existingPayment.rows.length > 0) {
            return res.json({
                success: true,
                data: {
                    user: userResult.rows[0],
                    application: application,
                    availableTiers: [],
                    alreadyPaid: true,
                    payment: existingPayment.rows[0],
                }
            });
        }
        
        res.json({
            success: true,
            data: {
                user: userResult.rows[0],
                application: application,
                availableTiers: tiersResult.rows.map(t => ({
                    tier: t.tier,
                    name: t.name,
                    amount: parseFloat(t.amount),
                    remaining: parseInt(t.remaining),
                    available: t.remaining > 0,
                })),
                alreadyPaid: false,
            }
        });
        
    } catch (err) {
        console.error('页面初始化失败:', err.message);
        res.status(500).json({ success: false, error: '页面初始化失败' });
    }
});

// ==========================================
// API 4: 创建支付订单
// POST /api/payments/create
// ==========================================
app.post('/api/payments/create', async (req, res) => {
    const { token, application_id, tier } = req.body;
    
    if (!token || !application_id || !tier) {
        return res.status(400).json({ 
            success: false, 
            error: '缺少必要参数' 
        });
    }
    
    try {
        // 验证 token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 检查档位是否还有名额（使用事务防止并发超卖）
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 获取档位信息并锁定
            const tierResult = await client.query(`
                SELECT t.*, COUNT(p.id) as paid_count
                FROM qcore_payment_tiers t
                LEFT JOIN qcore_payments p ON p.tier = t.tier AND p.status = 'paid'
                WHERE t.tier = $1
                GROUP BY t.tier
                FOR UPDATE
            `, [tier]);
            
            if (tierResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: '无效的档位' });
            }
            
            const tierInfo = tierResult.rows[0];
            const remaining = tierInfo.max_slots - parseInt(tierInfo.paid_count);
            
            if (remaining <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    error: '该档位已满，请选择其他档位' 
                });
            }
            
            // 检查是否已支付
            const existingResult = await client.query(
                'SELECT id FROM qcore_payments WHERE application_id = $1 AND status = $2',
                [application_id, 'paid']
            );
            
            if (existingResult.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    error: '该申请已支付' 
                });
            }
            
            // 创建支付订单
            const orderId = `QC${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
            
            const paymentResult = await client.query(`
                INSERT INTO qcore_payments 
                (application_id, user_id, tier, amount, status, batch_number)
                VALUES ($1, $2, $3, $4, 'pending', 1)
                RETURNING id
            `, [application_id, decoded.userId, tier, tierInfo.amount]);
            
            await client.query('COMMIT');
            
            // 调用支付宝创建支付
            const subject = `Q-core 2026 - ${tierInfo.name}`;
            
            const alipayResult = await alipaySdk.pageExec('alipay.trade.page.pay', {
                notifyUrl: ALIPAY_CONFIG.notifyUrl,
                returnUrl: `${ALIPAY_CONFIG.returnUrl}?payment_id=${paymentResult.rows[0].id}`,
                bizContent: {
                    out_trade_no: orderId,
                    product_code: 'FAST_INSTANT_TRADE_PAY',
                    total_amount: tierInfo.amount.toFixed(2),
                    subject: subject,
                    body: `Q-core 2026 课程报名 - ${tierInfo.name}`,
                },
            });
            
            res.json({
                success: true,
                data: {
                    paymentId: paymentResult.rows[0].id,
                    orderId: orderId,
                    amount: parseFloat(tierInfo.amount),
                    tier: tier,
                    payUrl: alipayResult,
                }
            });
            
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
        
    } catch (err) {
        console.error('创建支付订单失败:', err.message);
        res.status(500).json({ success: false, error: '创建支付订单失败: ' + err.message });
    }
});

// ==========================================
// API 5: 支付宝异步通知
// POST /api/alipay/notify
// ==========================================
app.post('/api/alipay/notify', async (req, res) => {
    console.log('🔔 收到支付宝异步通知');
    
    try {
        const signVerified = alipaySdk.checkNotifySign(req.body);
        
        if (!signVerified) {
            console.error('❌ 验签失败');
            return res.send('fail');
        }
        
        const params = req.body;
        const orderId = params.out_trade_no;
        const tradeNo = params.trade_no;
        const tradeStatus = params.trade_status;
        const totalAmount = params.total_amount;
        
        console.log('支付通知:', { orderId, tradeStatus, tradeNo });
        
        if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
            // 通过 out_trade_no 查找并更新支付记录
            const result = await query(
                `UPDATE qcore_payments 
                 SET status = 'paid', transaction_id = $1, paid_at = NOW(), updated_at = NOW()
                 WHERE out_trade_no = $2 AND status = 'pending'
                 RETURNING id, application_id, user_id, tier, amount`,
                [tradeNo, orderId]
            );
            
            if (result.rows.length > 0) {
                const payment = result.rows[0];
                console.log('✅ 支付记录已更新, payment_id:', payment.id, ', amount:', payment.amount);
                
                // 同步更新 qcore_applications 状态为 paid
                let appUpdated = false;
                if (payment.application_id) {
                    try {
                        const updateResult = await query(
                            `UPDATE qcore_applications 
                             SET status = 'paid', paid_at = NOW(), updated_at = NOW()
                             WHERE id = $1 AND status = 'approved'
                             RETURNING id`,
                            [payment.application_id]
                        );
                        if (updateResult.rows.length > 0) {
                            console.log('✅ 申请状态已同步为 paid, application_id:', payment.application_id);
                            appUpdated = true;
                        } else {
                            console.log('⚠️ 未找到对应申请或状态不是 approved, application_id:', payment.application_id);
                        }
                    } catch (appUpdateErr) {
                        console.error('❌ 更新申请状态失败:', appUpdateErr.message);
                    }
                }
                
                // 兜底：如果通过 application_id 更新失败，尝试通过 user_id 查找最新的 approved 申请
                if (!appUpdated && payment.user_id) {
                    try {
                        const findAppResult = await query(
                            'SELECT id FROM qcore_applications WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
                            [payment.user_id, 'approved']
                        );
                        if (findAppResult.rows.length > 0) {
                            const appId = findAppResult.rows[0].id;
                            await query(
                                `UPDATE qcore_applications 
                                 SET status = 'paid', paid_at = NOW(), updated_at = NOW()
                                 WHERE id = $1`,
                                [appId]
                            );
                            console.log('✅ 通过 user_id 兜底更新申请状态为 paid, application_id:', appId);
                            appUpdated = true;
                        } else {
                            console.log('⚠️ 通过 user_id 也未找到 approved 状态的申请, user_id:', payment.user_id);
                        }
                    } catch (findErr) {
                        console.error('❌ 通过 user_id 查找申请失败:', findErr.message);
                    }
                }
                
                if (!appUpdated && !payment.application_id) {
                    console.log('⚠️ 缺少 application_id，跳过申请状态更新');
                }
                
                // 回调 camp2026 更新状态
                try {
                    await fetch(`${CAMP2026_API}/api/payments/callback`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            application_id: payment.application_id,
                            status: 'paid',
                            tier: payment.tier,
                            transaction_id: tradeNo,
                        })
                    });
                    console.log('✅ 已通知 camp2026');
                } catch (callbackErr) {
                    console.error('回调 camp2026 失败:', callbackErr.message);
                }
            } else {
                console.log('⚠️ 未找到对应的待支付记录, out_trade_no:', orderId);
            }
        }
        
        res.send('success');
        
    } catch (err) {
        console.error('处理通知失败:', err.message);
        res.send('fail');
    }
});

// ==========================================
// API 6: 支付结果查询
// GET /api/payments/result?payment_id=xxx
// ==========================================
app.get('/api/payments/result', async (req, res) => {
    const { payment_id } = req.query;
    
    if (!payment_id) {
        return res.status(400).json({ success: false, error: '缺少 payment_id' });
    }
    
    try {
        const result = await query(
            'SELECT * FROM qcore_payments WHERE id = $1',
            [payment_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: '支付记录不存在' });
        }
        
        const payment = result.rows[0];
        
        res.json({
            success: true,
            data: {
                paymentId: payment.id,
                status: payment.status,
                tier: payment.tier,
                amount: parseFloat(payment.amount),
                paidAt: payment.paid_at,
                applicationId: payment.application_id,
            }
        });
        
    } catch (err) {
        console.error('查询支付结果失败:', err.message);
        res.status(500).json({ success: false, error: '查询失败' });
    }
});

// ==========================================
// API 7: 通过商户订单号查询支付状态（前端轮询用）
// GET /api/payments/query?order_id=xxx
// ==========================================
app.get('/api/payments/query', async (req, res) => {
    const { order_id } = req.query;
    
    if (!order_id) {
        return res.status(400).json({ success: false, error: '缺少 order_id' });
    }
    
    try {
        // 先查数据库
        const result = await query(
            'SELECT * FROM qcore_payments WHERE out_trade_no = $1',
            [order_id]
        );
        
        if (result.rows.length > 0) {
            const payment = result.rows[0];
            return res.json({
                success: true,
                data: {
                    paymentId: payment.id,
                    status: payment.status,
                    tier: payment.tier,
                    amount: parseFloat(payment.amount),
                    paidAt: payment.paid_at,
                    transactionId: payment.transaction_id,
                }
            });
        }
        
        // 数据库没找到，尝试通过支付宝 SDK 主动查询
        try {
            const alipayResult = await alipaySdk.exec('alipay.trade.query', {
                bizContent: {
                    out_trade_no: order_id,
                },
            });
            
            if (alipayResult.code === '10000') {
                const tradeStatus = alipayResult.tradeStatus;
                const isPaid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';
                
                // 如果支付宝显示已支付但数据库还没更新，主动更新数据库
                if (isPaid) {
                    try {
                        await query(
                            `UPDATE qcore_payments 
                             SET status = 'paid', transaction_id = $1, paid_at = NOW(), updated_at = NOW()
                             WHERE out_trade_no = $2 AND status = 'pending'
                             RETURNING id`,
                            [alipayResult.tradeNo, order_id]
                        );
                        console.log('✅ 通过主动查询更新了支付状态, order_id:', order_id);
                    } catch (updateErr) {
                        console.log('⚠️ 更新数据库失败:', updateErr.message);
                    }
                }
                
                return res.json({
                    success: true,
                    data: {
                        status: isPaid ? 'paid' : (tradeStatus === 'TRADE_CLOSED' ? 'closed' : 'pending'),
                        amount: parseFloat(alipayResult.totalAmount),
                        transactionId: alipayResult.tradeNo,
                    }
                });
            }
            
            // 支付宝查询失败（订单不存在等）
            return res.json({
                success: true,
                data: {
                    status: 'pending',
                }
            });
            
        } catch (queryErr) {
            console.log('⚠️ 支付宝查询失败:', queryErr.message);
            return res.json({
                success: true,
                data: {
                    status: 'pending',
                }
            });
        }
        
    } catch (err) {
        console.error('查询支付状态失败:', err.message);
        res.status(500).json({ success: false, error: '查询失败' });
    }
});

// ==========================================
// 健康检查
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        service: 'qcore-2026-payment-api',
        environment: isSandbox ? 'sandbox' : 'production',
        timestamp: new Date().toISOString(),
    });
});

// ==========================================
// API: 用户登录
// POST /api/auth/login
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, error: '请输入邮箱和密码' });
    }
    
    try {
        const result = await query(
            'SELECT id, email, full_name, password_hash, created_at FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: '邮箱或密码错误' });
        }
        
        const user = result.rows[0];
        
        // 密码验证（支持 bcrypt 和明文，兼容 camp2026 的加密方式）
        const bcrypt = require('bcryptjs');
        let passwordValid = false;
        
        if (user.password_hash && user.password_hash.startsWith('$2')) {
            // bcrypt 加密
            passwordValid = await bcrypt.compare(password, user.password_hash);
        } else if (user.password_hash) {
            // 明文或简单加密（开发环境）
            passwordValid = (password === user.password_hash);
        }
        
        if (!passwordValid) {
            return res.status(401).json({ success: false, error: '邮箱或密码错误' });
        }
        
        // 生成 JWT Token
        const token = jwt.sign(
            { userId: user.id, email: user.email, name: user.full_name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        console.log('✅ 用户登录成功:', user.email);
        
        res.json({
            success: true,
            data: {
                token: token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.full_name,
                }
            }
        });
        
    } catch (err) {
        console.error('登录失败:', err.message);
        res.status(500).json({ success: false, error: '登录失败' });
    }
});

// ==========================================
// API: 获取当前用户信息
// GET /api/auth/me
// ==========================================
app.get('/api/auth/me', verifyToken, async (req, res) => {
    try {
        const result = await query(
            'SELECT id, email, full_name, created_at FROM users WHERE id = $1',
            [req.user.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: '用户不存在' });
        }
        
        const user = result.rows[0];
        
        // 查询用户的支付记录
        const payments = await query(
            'SELECT id, tier, amount, status, created_at FROM qcore_payments WHERE user_id = $1 ORDER BY created_at DESC',
            [user.id]
        );
        
        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.full_name,
                },
                payments: payments.rows
            }
        });
        
    } catch (err) {
        console.error('获取用户信息失败:', err.message);
        res.status(500).json({ success: false, error: '获取用户信息失败' });
    }
});

// ==========================================
// API: 兼容旧版支付接口
// POST /api/alipay/pay
// ==========================================
app.post('/api/alipay/pay', async (req, res) => {
    console.log('📦 收到支付请求:', req.body);
    
    const { orderId, plan, billing, amount, userId, applicationId } = req.body;
    
    if (!orderId || !amount) {
        return res.status(400).json({ error: '缺少必要参数: orderId, amount' });
    }
    
    try {
        const tierMap = {
            'early_bird': '早鸟价',
            'second_batch': '第二批', 
            'third_batch': '第三批',
            'regular': '原价'
        };
        
        // 确保 out_trade_no 列存在
        try {
            await query(`ALTER TABLE qcore_payments ADD COLUMN IF NOT EXISTS out_trade_no VARCHAR(128)`);
        } catch (e) {
            console.log('⚠️ 添加 out_trade_no 列失败:', e.message);
        }
        
        // 创建数据库订单记录
        let paymentId = null;
        try {
            const dbResult = await query(
                `INSERT INTO qcore_payments 
                (application_id, user_id, tier, amount, status, batch_number, out_trade_no)
                VALUES ($1, $2, $3, $4, 'pending', 1, $5)
                RETURNING id`,
                [applicationId || 0, userId || 0, plan, amount, orderId]
            );
            paymentId = dbResult.rows[0]?.id;
            console.log('✅ 数据库订单已创建, payment_id:', paymentId, ', user_id:', userId, ', application_id:', applicationId, ', out_trade_no:', orderId);
        } catch (dbErr) {
            console.log('⚠️ 数据库保存失败:', dbErr.message);
        }
        
        // 调用支付宝创建支付
        const subject = `ASP.cool ${tierMap[plan] || '课程报名'}`;
        
        const result = await alipaySdk.pageExec('alipay.trade.page.pay', {
            notifyUrl: ALIPAY_CONFIG.notifyUrl,
            returnUrl: ALIPAY_CONFIG.returnUrl,
            bizContent: {
                out_trade_no: orderId,
                product_code: 'FAST_INSTANT_TRADE_PAY',
                total_amount: parseFloat(amount).toFixed(2),
                subject: subject,
                body: 'Q-core 2026 课程报名',
            },
        });
        
        console.log('✅ 支付宝表单生成成功');
        res.json({ 
            formHtml: result,
            paymentId: paymentId,
            orderId: orderId
        });
        
    } catch (err) {
        console.error('❌ 创建支付订单失败:', err.message);
        res.status(500).json({ error: '创建支付订单失败: ' + err.message });
    }
});

// ==========================================
// 静态文件服务
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 启动服务
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('🚀 Q-core 2026 支付服务已启动');
    console.log('   地址: http://localhost:' + PORT);
    console.log('   环境:', isSandbox ? '沙箱' : '正式');
    console.log('');
    console.log('📋 可用接口:');
    console.log('   GET  /api/auth/verify        - 验证 JWT Token');
    console.log('   GET  /api/tiers/available    - 获取可用档位');
    console.log('   GET  /api/payments/page-init - 支付页面初始化');
    console.log('   POST /api/payments/create    - 创建支付订单');
    console.log('   POST /api/alipay/pay         - 兼容支付接口（返回表单HTML）');
    console.log('   POST /api/alipay/notify      - 支付宝异步通知');
    console.log('   GET  /api/payments/result    - 查询支付结果（按payment_id）');
    console.log('   GET  /api/payments/query     - 查询支付状态（按order_id，前端轮询用）');
    console.log('   POST /api/auth/login         - 用户登录');
    console.log('   GET  /api/auth/me            - 获取当前用户信息');
    console.log('');
});
