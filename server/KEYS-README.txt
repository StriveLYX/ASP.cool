# ==========================================
# 支付宝密钥配置说明
# ==========================================
#
# 步骤 1: 生成 RSA2 密钥对
#   方法 A: 使用支付宝密钥工具
#     下载地址: https://opendocs.alipay.com/common/02kipk
#   方法 B: 使用 OpenSSL 命令行
#     openssl genrsa -out app_private_key.pem 2048
#     openssl rsa -in app_private_key.pem -pubout -out app_public_key.pem
#
# 步骤 2: 在支付宝开放平台配置公钥
#   登录 https://open.alipay.com → 应用详情 → 开发设置 → 接口加签方式
#   上传 app_public_key.pem 的内容
#
# 步骤 3: 获取支付宝公钥
#   配置完成后，支付宝会生成一个"支付宝公钥"
#   将其保存到 alipay-public-key.pem
#
# 步骤 4: 将应用私钥保存到 private-key.pem
#   ⚠️ 私钥绝对不能泄露或上传到公共仓库！
#
# 沙箱环境:
#   登录 https://open.alipay.com → 开发服务 → 研发服务 → 沙箱
#   获取沙箱 AppID、密钥等
#
# ==========================================

# 应用私钥（替换为您的真实私钥内容）
# 格式如下：
# -----BEGIN PRIVATE KEY-----
# MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...
# ...
# -----END PRIVATE KEY-----
