import * as echarts from 'echarts';
import { RunBacktest } from '../wailsjs/go/main/App';

// 1. 注入 CSS 样式（仅修改了颜色变量，买入红、卖出绿）
const style = document.createElement('style');
style.innerHTML = `
    :root {
        --bg-app: #0d1117; --bg-side: #161b22; --border: #30363d;
        --text-main: #c9d1d9; --text-bright: #ffffff; --accent: #3b82f6;
        --color-buy: #ef4444;    /* 买入红色 */
        --color-sell: #10b981;   /* 卖出绿色 */
    }
    .light-theme {
        --bg-app: #ffffff; --bg-side: #f6f8fa; --border: #d0d7de;
        --text-main: #24292f; --text-bright: #0969da; --accent: #0969da;
    }
    body { margin: 0; background: var(--bg-app); color: var(--text-main); font-family: sans-serif; height: 100vh; overflow: hidden; }
    .app-container { display: flex; height: 100vh; }
    
    .sidebar { width: 280px; background: var(--bg-side); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
    .input-group { padding: 20px; display: flex; flex-direction: column; gap: 15px; flex: 1; overflow-y: auto; }
    
    .param-box { padding: 12px; background: rgba(59,130,246,0.05); border: 1px dashed var(--border); border-radius: 8px; }
    .input-field { width: 100%; background: var(--bg-app); border: 1px solid var(--border); color: var(--text-main); padding: 8px; border-radius: 6px; box-sizing: border-box; }

    /* 新增 placeholder 颜色：更淡，避免误认为已填入内容 */
    .dark-theme .input-field::placeholder {
        color: rgba(255, 255, 255, 0.35);
    }
    .light-theme .input-field::placeholder {
        color: rgba(0, 0, 0, 0.35);
    }

    /* 针对日期输入框的暗色模式优化 */
    .dark-theme .input-field[type="date"] { color-scheme: dark; }
    .light-theme .input-field[type="date"] { color-scheme: light; }
    
    .text-buy { color: var(--color-buy) !important; font-weight: bold; }
    .text-sell { color: var(--color-sell) !important; font-weight: bold; }
    
    main { flex: 1; display: flex; flex-direction: column; background: var(--bg-app); }
    #chart-box { flex: 1; width: 100%; height: 100%; }
    .log-view { height: 250px; background: var(--bg-side); border-top: 1px solid var(--border); overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 10px 15px; text-align: left; border-bottom: 1px solid var(--border); }
    th { font-weight: 700; color: var(--text-main); }
    
    /* 平滑主题切换过渡 */
* {
    transition: background-color 0.3s ease, 
                color 0.3s ease, 
                border-color 0.3s ease, 
                box-shadow 0.3s ease;
}
    
    .btn-run { margin: 15px; padding: 12px; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
`;
document.head.appendChild(style);

// 2. 注入 HTML 结构（未改动）
document.querySelector('#app').innerHTML = `
    <div id="app-frame" class="app-container dark-theme">
        <aside class="sidebar">
            <div style="padding:15px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between;">
                <b style="color:var(--accent)">QUANT-A</b>
                <button id="themeToggle" style="font-size:14px; background:transparent; border:none; cursor:pointer; color:var(--text-main);">☀️ 切换 🌙</button>
            </div>
            <div class="input-group">
                <label style="font-size:12px; color:gray;">标的配置</label>
                <input id="inCode" placeholder="股票代码" class="input-field">
                <input id="inCap" placeholder="初始资金" class="input-field">
                
                <div class="param-box">
                    <label style="font-size:12px; color:var(--accent);">MACD 参数</label>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-top:5px;">
                        <input id="inFast" placeholder="快线" value="12" class="input-field" title="快线">
                        <input id="inSlow" placeholder="慢线" value="26" class="input-field" title="慢线">
                        <input id="inSig" placeholder="信号" value="9" class="input-field" title="信号">
                    </div>
                </div>

                <label style="font-size:12px; color:gray;">回测时间（仅支持2023年9月以后的数据）</label>
                <div style="font-size:11px; color:gray; margin-bottom:-5px;">起始日期</div>
                <input id="inStart" type="date" class="input-field">
                <div style="font-size:11px; color:gray; margin-bottom:-5px;">截止日期</div>
                <input id="inEnd" type="date" class="input-field">
            </div>
            <button id="runBtn" class="btn-run">开始执行 / RUN</button>
        </aside>
        <main>
            <div style="padding:15px; display:flex; gap:30px; border-bottom:1px solid var(--border); background:var(--bg-side);">
                <div><small style="color:gray;">最终资产</small><div id="resCap" style="font-size:18px; font-weight:bold;">¥ --</div></div>
                <div><small style="color:gray;">累计收益</small><div id="resRet" style="font-size:18px; font-weight:bold;">-- %</div></div>
            </div>
            <div id="chart-box"></div>
            <div class="log-view">
                <table>
                    <thead><tr><th>📅 日期</th><th>📊 操作</th><th>💰 价格</th></tr></thead>
                    <tbody id="logBody"></tbody>
                </table>
            </div>
        </main>
    </div>
`;

// 3. 核心逻辑
let myChart = null, currentTheme = 'dark', lastRes = null;

function getThemeVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 渲染日志（买入红色、卖出绿色，由 CSS 类控制，颜色变量已互换）
function renderLogs(logs) {
    const tbody = document.getElementById('logBody');
    tbody.innerHTML = logs.map(l => {
        const isBuy = l.action === '买入' || l.action.toUpperCase() === 'BUY';
        return `<tr>
            <td style="color:var(--text-bright)">${l.date}</td>
            <td class="${isBuy ? 'text-buy' : 'text-sell'}">${l.action}</td>
            <td style="color:var(--accent)">¥${l.price.toFixed(2)}</td>
        </tr>`;
    }).join('');
}

// 渲染图表（买入红圈带“买”字，卖出绿圈带“卖”字）
function renderChart(res) {
    if (myChart) myChart.dispose();
    myChart = echarts.init(document.getElementById('chart-box'));
    const isLight = currentTheme === 'light';
    
    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: function(params) {
                const data = params[0];
                return `${data.name}<br/>净值：¥ ${data.value.toFixed(2)}`;
            }
        },
        grid: { top: 50, bottom: 80, left: 40, right: 60, containLabel: true },
        xAxis: {
            type: 'category',
            data: res.dates,
            axisLabel: { color: 'gray', rotate: 30, margin: 10 },
            axisLine: { lineStyle: { color: 'var(--border)' } },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value',
            scale: true,
            position: 'right',
            axisLabel: { color: 'gray' },
            splitLine: { show: true, lineStyle: { type: 'dashed', color: 'rgba(128,128,128,0.3)' } }
        },
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', bottom: 20, height: 20, borderColor: 'transparent', backgroundColor: 'rgba(128,128,128,0.2)' }
        ],
        series: [{
            name: '账户净值',
            type: 'line',
            data: res.chart_data,
            symbol: 'none',
            lineStyle: { color: '#3b82f6', width: 2 },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(59,130,246,0.3)' },
                    { offset: 1, color: 'transparent' }
                ])
            },
            markPoint: {
                symbol: 'circle',
                symbolSize: 18,  // 增大以容纳文字
                data: res.logs.map(l => ({
                    coord: [l.date, res.chart_data[res.dates.indexOf(l.date)]],
                    value: l.action === '买入' || l.action.toUpperCase() === 'BUY' ? '买' : '卖',
                    itemStyle: {
                        color: (l.action === '买入' || l.action.toUpperCase() === 'BUY') ? '#ef4444' : '#10b981',  // 买入红、卖出绿
                        borderColor: '#ffffff',
                        borderWidth: 1
                    }
                })),
                label: {
                    show: true,
                    position: 'inside',
                    color: '#ffffff',
                    fontSize: 10,
                    fontWeight: 'bold',
                    formatter: (params) => params.value  // 显示“买”或“卖”
                }
            }
        }]
    };
    myChart.setOption(option);
}

// 点击运行（处理收益颜色和符号，以及最终资产数字颜色）
document.getElementById('runBtn').onclick = async () => {
    const btn = document.getElementById('runBtn');
    btn.innerText = "正在运行...";
    try {
        const res = await RunBacktest(
            document.getElementById('inCode').value,
            parseFloat(document.getElementById('inCap').value),
            document.getElementById('inStart').value,
            document.getElementById('inEnd').value,
            parseInt(document.getElementById('inFast').value),
            parseInt(document.getElementById('inSlow').value),
            parseInt(document.getElementById('inSig').value)
        );
        lastRes = res;

        // 最终资产数字颜色：亮色模式黑色，暗色模式白色
        const capElement = document.getElementById('resCap');
        capElement.innerText = `¥ ${res.final_capital.toLocaleString()}`;
        capElement.style.color = currentTheme === 'light' ? '#000000' : '';

        // 累计收益：正红负绿，并显式添加符号
        const ret = res.total_return;
        const retElement = document.getElementById('resRet');
        retElement.innerText = `${ret > 0 ? '+' : ''}${ret.toFixed(2)}%`;
        retElement.style.color = ret >= 0 ? '#ef4444' : '#10b981';  // 盈利红色，亏损绿色

        renderChart(res);
        renderLogs(res.logs);
    } catch (e) { alert(e); }
    btn.innerText = "开始执行 / RUN";
};

// 主题切换逻辑（更新主题类、按钮符号，并调整最终资产颜色）
document.getElementById('themeToggle').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    const frame = document.getElementById('app-frame');
    frame.className = `app-container ${currentTheme}-theme`;
    // 更新按钮符号
    const btn = document.getElementById('themeToggle');
    btn.innerHTML = currentTheme === 'dark' ? '☀️ 切换 🌙' : '🌙 切换 ☀️';

    // 根据主题调整最终资产数字颜色
    const capElement = document.getElementById('resCap');
    if (lastRes) {
        capElement.style.color = currentTheme === 'light' ? '#000000' : '';
    }

    if (lastRes) renderChart(lastRes);
};

window.onresize = () => myChart && myChart.resize();
