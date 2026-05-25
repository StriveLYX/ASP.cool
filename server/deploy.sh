#!/bin/bash
# ==========================================
# Q-core 2026 支付服务 一键部署脚本
# ==========================================

set -e

echo ""
echo "=========================================="
echo "  Q-core 2026 支付服务 一键部署"
echo "=========================================="
echo ""

# ==========================================
# 1. 读取 camp2026 的数据库配置
# ==========================================
echo "📋 步骤 1/7: 读取数据库配置..."

ENV_FILE="/var/www/asp-cool/backend/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ 找不到 camp2026 配置文件: $ENV_FILE"
    exit 1
fi

DB_USER=$(grep -oP 'DB_USER=\K.*' "$ENV_FILE" | head -1)
DB_PASSWORD=$(grep -oP 'DB_PASSWORD=\K.*' "$ENV_FILE" | head -1)
DB_NAME=$(grep -oP 'DB_NAME=\K.*' "$ENV_FILE" | head -1)
DB_HOST=$(grep -oP 'DB_HOST=\K.*' "$ENV_FILE" | head -1)
DB_PORT=$(grep -oP 'DB_PORT=\K.*' "$ENV_FILE" | head -1)
JWT_SECRET=$(grep -oP 'JWT_SECRET=\K.*' "$ENV_FILE" | head -1)

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-asp_auth}
DB_USER=${DB_USER:-postgres}

echo "   DB_HOST:  $DB_HOST"
echo "   DB_PORT:  $DB_PORT"
echo "   DB_NAME:  $DB_NAME"
echo "   DB_USER:  $DB_USER"
echo "   JWT_SECRET: ${JWT_SECRET:0:10}..."
echo "   ✅ 配置读取成功"
echo ""

# ==========================================
# 2. 创建项目目录
# ==========================================
echo "📋 步骤 2/7: 创建项目目录..."

PROJECT_DIR="/home/ubuntu/aspcool/server"
mkdir -p "$PROJECT_DIR/public"

echo "   ✅ 目录: $PROJECT_DIR"
echo ""

# ==========================================
# 3. 创建数据库表
# ==========================================
echo "📋 步骤 3/7: 创建数据库表..."

SQL_FILE="/tmp/qcore_init.sql"

cat > "$SQL_FILE" << 'SQLEOF'
CREATE TABLE IF NOT EXISTS qcore_payments (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('early_bird', 'second_batch', 'third_batch', 'regular')),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    payment_method VARCHAR(50),
    payment_channel VARCHAR(50),
    transaction_id VARCHAR(100),
    paid_at TIMESTAMP WITH TIME ZONE,
    batch_number INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qcore_payment_tiers (
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

INSERT INTO qcore_payment_tiers (tier, name, amount, max_slots) VALUES
('early_bird', '早鸟价', 9800.00, 30),
('second_batch', '第二批', 11800.00, 60),
('third_batch', '第三批', 13800.00, 100),
('regular', '原价', 15800.00, 999999)
ON CONFLICT (tier) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_payments_app_id ON qcore_payments(application_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON qcore_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON qcore_payments(status);
SQLEOF

DB_SUCCESS=0

# 尝试方式1: PGPASSWORD 环境变量
if [ -n "$DB_PASSWORD" ]; then
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE" 2>/dev/null && DB_SUCCESS=1
fi

# 尝试方式2: sudo
if [ "$DB_SUCCESS" -eq 0 ]; then
    sudo -u "$DB_USER" psql -d "$DB_NAME" -f "$SQL_FILE" 2>/dev/null && DB_SUCCESS=1
fi

# 尝试方式3: 直接 psql
if [ "$DB_SUCCESS" -eq 0 ]; then
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE" 2>/dev/null && DB_SUCCESS=1
fi

if [ "$DB_SUCCESS" -eq 1 ]; then
    echo "   ✅ 数据库表创建成功"
else
    echo "   ⚠️  自动创建失败，请手动执行: psql -d $DB_NAME -f $SQL_FILE"
fi

rm -f "$SQL_FILE"
echo ""

# ==========================================
# 4. 检查密钥文件
# ==========================================
echo "📋 步骤 4/7: 检查密钥文件..."

PEM_COUNT=0
for pem in private-key.pem alipay-public-key.pem sandbox-private-key.pem sandbox-alipay-public-key.pem; do
    if [ -f "$PROJECT_DIR/$pem" ]; then
        echo "   ✅ $pem"
        PEM_COUNT=$((PEM_COUNT + 1))
    fi
done

if [ $PEM_COUNT -eq 0 ]; then
    echo "   ⚠️  未找到密钥文件，请上传到 $PROJECT_DIR/"
fi
echo ""

# ==========================================
# 5. 创建 .env 文件
# ==========================================
echo "📋 步骤 5/7: 创建 .env 文件..."

cat > "$PROJECT_DIR/.env" << ENVEOF
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
CAMP2026_API=https://camp2026.asp.cool
PORT=3000
ENVEOF

echo "   ✅ .env 已创建"
echo ""

# ==========================================
# 6. 安装依赖
# ==========================================
echo "📋 步骤 6/7: 安装依赖..."

cd "$PROJECT_DIR"

cat > package.json << 'PKGEOF'
{
  "name": "qcore-2026-payment",
  "version": "1.0.0",
  "main": "server-qcore.js",
  "scripts": {
    "start": "node server-qcore.js",
    "sandbox": "node server-qcore.js --sandbox"
  },
  "dependencies": {
    "express": "^4.18.0",
    "alipay-sdk": "^4.0.0",
    "jsonwebtoken": "^9.0.0",
    "pg": "^8.11.0",
    "dotenv": "^16.3.0"
  }
}
PKGEOF

npm install --production 2>&1 | tail -3

echo "   ✅ 依赖安装完成"
echo ""

# ==========================================
# 7. 启动 PM2 服务
# ==========================================
echo "📋 步骤 7/7: 启动服务..."

if ! command -v pm2 &> /dev/null; then
    echo "   安装 PM2..."
    sudo npm install -g pm2
fi

pm2 delete qcore-payment 2>/dev/null || true
pm2 delete my-server 2>/dev/null || true

cd "$PROJECT_DIR"
export $(cat .env | grep -v '^#' | xargs)
pm2 start server-qcore.js --name "qcore-payment"
pm2 save

echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
pm2 list
echo ""
echo "📋 测试命令:"
echo "   curl http://127.0.0.1:3000/api/health"
echo "   curl http://127.0.0.1:3000/api/tiers/available"
echo "   pm2 logs qcore-payment"
echo ""
