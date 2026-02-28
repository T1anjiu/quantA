package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	
	"github.com/markcheno/go-talib"
)

type TradeLog struct {
	Date   string  `json:"date"`
	Action string  `json:"action"`
	Price  float64 `json:"price"`
}

type BacktestResult struct {
	Logs         []TradeLog `json:"logs"`
	FinalCapital float64    `json:"final_capital"`
	TotalReturn  float64    `json:"total_return"`
	ChartData    []float64  `json:"chart_data"`
	Dates        []string   `json:"dates"`
}

type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }
func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// fetchStockData 从东方财富获取历史日线数据（前复权）
func (a *App) fetchStockData(symbol string) ([]string, []float64, error) {
    // 1. 格式化股票代码 (与你成功访问的URL参数保持一致)
    pureSymbol := strings.TrimSpace(symbol)
    pureSymbol = strings.ReplaceAll(pureSymbol, ".SH", "")
    pureSymbol = strings.ReplaceAll(pureSymbol, ".SZ", "")
    for len(pureSymbol) < 6 {
        pureSymbol = "0" + pureSymbol
    }

    marketPrefix := "0"
    if strings.HasPrefix(pureSymbol, "6") || strings.HasPrefix(pureSymbol, "5") || strings.HasPrefix(pureSymbol, "688") {
        marketPrefix = "1"
    }
    secID := fmt.Sprintf("%s.%s", marketPrefix, pureSymbol)

    // 2. 构造URL —— 使用你验证成功的完整参数
    url := fmt.Sprintf("http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=%s&fields1=f1&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=500",
        secID)

    // 3. 创建HTTP客户端（可以设置超时，避免一直等待）
    client := &http.Client{
        // 可选：设置超时，例如10秒
        // Timeout: 10 * time.Second,
    }
    req, err := http.NewRequest("GET", url, nil)
    if err != nil {
        return nil, nil, fmt.Errorf("创建请求失败: %v", err)
    }
    // 模拟浏览器User-Agent，有时可减少被拒绝的几率
    req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

    resp, err := client.Do(req)
    if err != nil {
        return nil, nil, fmt.Errorf("HTTP请求失败: %v", err)
    }
    // **关键：确保resp.Body被正确关闭和读取**
    defer resp.Body.Close()

    // 读取完整响应体
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, nil, fmt.Errorf("读取响应体失败: %v", err)
    }

    // 4. 解析JSON (与之前相同)
    var result struct {
        Rc   int `json:"rc"`
        Data *struct {
            Klines []string `json:"klines"`
        } `json:"data"`
    }
    if err := json.Unmarshal(body, &result); err != nil {
        return nil, nil, fmt.Errorf("解析JSON失败: %v (响应内容: %s)", err, string(body))
    }
    if result.Rc != 0 {
        return nil, nil, fmt.Errorf("接口返回错误码: %d", result.Rc)
    }
    if result.Data == nil || len(result.Data.Klines) == 0 {
        return nil, nil, fmt.Errorf("未获取到K线数据")
    }

    // 5. 解析K线数据 (格式: "2024-01-29,8.14")
    var dates []string
    var closes []float64
    for _, kline := range result.Data.Klines {
        parts := strings.Split(kline, ",")
        if len(parts) < 2 {
            continue
        }
        dateStr := strings.ReplaceAll(parts[0], "-", "")
        price, err := strconv.ParseFloat(parts[1], 64)
        if err != nil {
            continue
        }
        dates = append(dates, dateStr)
        closes = append(closes, price)
    }

    if len(dates) == 0 {
        return nil, nil, fmt.Errorf("未能解析出有效价格数据")
    }

    return dates, closes, nil
}

// RunBacktest 保持不变
func (a *App) RunBacktest(symbol string, initialCapital float64, startDate string, endDate string, fastPeriod int, slowPeriod int, signalPeriod int) (BacktestResult, error) {
	allDates, allCloses, err := a.fetchStockData(symbol)
	if err != nil {
		return BacktestResult{}, err
	}

	fStart := strings.ReplaceAll(startDate, "-", "")
	fEnd := strings.ReplaceAll(endDate, "-", "")

	dif, dea, _ := talib.Macd(allCloses, fastPeriod, slowPeriod, signalPeriod)

	var logs []TradeLog
	var filteredDates []string
	var filteredChart []float64

	capital := initialCapital
	position := 0.0

	startIndex := 0
	for i, d := range allDates {
		if d >= fStart {
			startIndex = i
			break
		}
	}

	for i := startIndex; i < len(allCloses); i++ {
		if fEnd != "" && allDates[i] > fEnd {
			break
		}

		if i > 0 && dif[i-1] != 0 {
			if position == 0 && dif[i] > dea[i] && dif[i-1] <= dea[i-1] {
				position = capital / allCloses[i]
				capital = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "买入", Price: allCloses[i]})
			} else if position > 0 && dif[i] < dea[i] && dif[i-1] >= dea[i-1] {
				capital = position * allCloses[i]
				position = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "卖出", Price: allCloses[i]})
			}
		}

		val := capital
		if position > 0 {
			val = position * allCloses[i]
		}
		filteredDates = append(filteredDates, allDates[i])
		filteredChart = append(filteredChart, val)
	}

	if logs == nil {
		logs = []TradeLog{}
	}
	finalVal := initialCapital
	if len(filteredChart) > 0 {
		finalVal = filteredChart[len(filteredChart)-1]
	}

	return BacktestResult{
		Logs:         logs,
		FinalCapital: finalVal,
		TotalReturn:  (finalVal - initialCapital) / initialCapital * 100,
		ChartData:    filteredChart,
		Dates:        filteredDates,
	}, nil
}
