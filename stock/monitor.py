import os
import requests
import efinance as ef
import pandas as pd
from datetime import datetime

TOKEN = os.environ.get("TG_BOT_TOKEN")
CHAT_ID = os.environ.get("TG_CHAT_ID")
CF_URL = os.environ.get("CF_WORKER_URL")

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message, "parse_mode": "Markdown"}
    try: requests.post(url, json=payload)
    except Exception as e: print(f"TG发送异常: {e}")

def get_stock_list_from_cloud():
    try:
        response = requests.get(CF_URL, timeout=10)
        if response.status_code == 200: return response.json()
    except Exception as e: print(f"从云端获取列表失败: {e}")
    return []

def save_to_web_page(report_content):
    """将报告保存为静态网页文件，并更新首页索引"""
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    # 确保 docs 和 docs/history 文件夹存在
    os.makedirs('docs/history', exist_ok=True)
    
    # 1. 生成当天的详情文件 (使用 HTML 的 details 标签实现点击展开)
    # 转换为适合网页阅读的 HTML 格式
    html_report = report_content.replace('\n', '<br>').replace('**', '<b>').replace('*', '<b>').replace('</b>:', '</b>:<br>')
    
    day_file_content = f"""<details>
<summary style="font-size: 1.2rem; font-weight: bold; cursor: pointer; padding: 10px; background: #f3f4f6; margin: 5px 0; border-radius: 5px;">📅 {today_str} 复盘报告 (点击展开)</summary>
<div style="padding: 15px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 5px 5px; line-height: 1.6;">
{html_report}
</div>
</details>
"""
    
    # 写入当天的历史记录
    with open(f'docs/history/{today_str}.html', 'w', encoding='utf-8') as f:
        f.write(day_file_content)
        
    # 2. 重新动态组装首页 index.html
    history_dir = 'docs/history'
    all_days = sorted([f for f in os.listdir(history_dir) if f.endswith('.html')], reverse=True)
    
    index_content = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📈 我的量化策略复盘看板</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
        h1 { border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
        .footer { margin-top: 5px; font-size: 0.8rem; color: #999; text-align: center; }
    </style>
</head>
<body>
    <h1>📈 量化策略历史复盘看板</h1>
    <p>数据每日自动更新，对比 TradingView 校验。点击日期可展开查看详情：</p>
    <div id="app">
"""
    
    # 把所有历史日期的内容合并到首页
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
    if not security_codes: return

    report_lines = []
    trigger_alert = False

    for code in security_codes:
        try:
            df_daily = ef.stock.get_quote_history(code, klt=101)[:20]
            if df_daily.empty: continue
                
            name = df_daily.iloc[-1]['股票名称']
            current_price = df_daily.iloc[-1]['收盘']
            pct_chg = df_daily.iloc[-1]['涨跌幅']
            
            # 策略核心逻辑（这里仅做示例，你可以换成你复杂的 TV 同款指标）
            if abs(pct_chg) >= 0.0: # 为了演示方便，设为0.0让每只股票都记录进网页，但你可以控制是否发TG
                trigger_alert = True
                direction = "📈 🟢" if pct_chg > 0 else "残留 🔴"
                report_lines.append(f"**{name} ({code})**:")
                report_lines.append(f"  • 收盘价: {current_price} ({direction} {pct_chg}%)")
                report_lines.append("-" * 20)
        except Exception as e:
            print(f"获取代码 {code} 失败: {e}")

    if report_lines:
        full_report = "\n".join(report_lines)
        # 无论触发没触发大跌，都写入网页供长期复盘
        save_to_web_page(full_report)
        # 如果触发了特殊条件，单独发一条 TG
        send_telegram_message("📊 *新复盘报告已生成！* \n\n" + full_report)

if __name__ == "__main__":
    get_and_check_data()
