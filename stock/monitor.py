import os
import requests
import efinance as ef
import pandas as pd
from datetime import datetime

# 从 GitHub Secrets 中安全读取变量
TOKEN = os.environ.get("TG_BOT_TOKEN")
CHAT_ID = os.environ.get("TG_CHAT_ID")
CF_URL = os.environ.get("CF_WORKER_URL")

def send_telegram_message(message):
    """发送消息到 Telegram"""
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message, "parse_mode": "Markdown"}
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        print(f"TG发送异常: {e}")

def get_stock_list_from_cloud():
    """从 Cloudflare Worker 获取最新的动态监测列表"""
    try:
        response = requests.get(CF_URL, timeout=10)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"从云端获取列表失败: {e}")
    return []

def save_to_web_page(report_content):
    """将报告保存为静态网页文件，并更新 index.html 首页"""
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    # 确保文件夹路径存在
    os.makedirs('docs/history', exist_ok=True)
    
    # 将文本换行格式转换为网页 HTML 格式
    html_report = report_content.replace('\n', '<br>').replace('**', '<b>').replace('*', '<b>')
    
    # 1. 生成当天的详情块（HTML details 标签实现点击收起/展开）
    day_file_content = f"""<details>
<summary style="font-size: 1.2rem; font-weight: bold; cursor: pointer; padding: 12px; background: #f3f4f6; margin: 8px 0; border-radius: 6px; border-left: 5px solid #3b82f6;">📅 {today_str} 复盘报告 (点击展开)</summary>
<div style="padding: 15px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 6px 6px; line-height: 1.6; background: #fff;">
{html_report}
</div>
</details>
"""
    # 写入当天的独立历史记录文件
    with open(f'docs/history/{today_str}.html', 'w', encoding='utf-8') as f:
        f.write(day_file_content)
        
    # 2. 重新编译 index.html 首页
    history_dir = 'docs/history'
    all_days = sorted([f for f in os.listdir(history_dir) if f.endswith('.html')], reverse=True)
    
    index_content = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📈 我的量化策略复盘看板</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; background: #f9fafb; }
        h1 { border-bottom: 2px solid #3b82f6; padding-bottom: 10px; color: #1e3a8a; }
        .footer { margin-top: 30px; font-size: 0.8rem; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
    </style>
</head>
<body>
    <h1>📈 量化策略历史复盘看板</h1>
    <p>数据每日自动更新。点击下方日期可展开查看详细策略对账：</p>
    <div id="app">
"""
    # 按日期倒序，把所有历史日期的组件全部拼接到首页
    for day in all_days:
        with open(os.path.join(history_dir, day), 'r', encoding='utf-8') as f:
            index_content += f.read() + "\n"
            
    index_content += f"""    </div>
    <div class="footer">最后更新时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
</body>
</html>"""
    
    with open('docs/index.html', 'w', encoding='utf-8') as f:
        f.write(index_content)

def get_and_check_data():
    security_codes = get_stock_list_from_cloud()
    if not security_codes:
        print("当前云端监测列表为空，无需执行。")
        return

    report_lines = []
    # 这里为了演示，只要列表有股票就生成网页报告；如需满足特定大涨跌才发TG，可以调整逻辑
    report_lines.append("📊 *今日 A股/ETF 策略监测细节* \n")

    for code in security_codes:
        try:
            # 获取日K线 (最新20天)
            df_daily = ef.stock.get_quote_history(code, klt=101)
            if df_daily is None or df_daily.empty: 
                continue
            df_daily = df_daily.tail(20)
                
            name = df_daily.iloc[-1]['股票名称']
            current_price = df_daily.iloc[-1]['收盘']
            pct_chg = df_daily.iloc[-1]['涨跌幅']
            
            # 📝 ----------- 你的 TradingView 同款核心计算逻辑写在这里 -----------
            # 示例：记录当前价格和涨跌幅。你可以随意增加均线、振幅等计算。
            direction = "📈 🟢" if pct_chg >= 0 else "📉 🔴"
            report_lines.append(f"*{name} ({code})*:")
            report_lines.append(f"  • 当前收盘价: {current_price} ({direction} {pct_chg}%)")
            report_lines.append("-" * 20)
            
        except Exception as e:
            print(f"获取代码 {code} 数据失败: {e}")

    if len(report_lines) > 1:
        full_report = "\n".join(report_lines)
        # 1. 永久归档到 GitHub Pages 网页中
        save_to_web_page(full_report)
        # 2. 同时发送推送到你的手机 Telegram
        send_telegram_message(full_report)

if __name__ == "__main__":
    if not TOKEN or not CHAT_ID or not CF_URL:
        print("错误: 检查 GitHub Secrets 环境变量是否配置完整！")
    else:
        get_and_check_data()
