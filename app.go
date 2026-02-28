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

// 核心函数：回归腾讯 proxy 接口
func (a *App) fetchStockData(symbol string) ([]string, []float64, error) {
	pureSymbol := strings.TrimSpace(symbol)
	pureSymbol = strings.ReplaceAll(pureSymbol, ".SH", "")
	pureSymbol = strings.ReplaceAll(pureSymbol, ".SZ", "")
	
	// 判定前缀
	prefix := "sz"
	if strings.HasPrefix(pureSymbol, "6") || strings.HasPrefix(pureSymbol, "5") || strings.HasPrefix(pureSymbol, "688") {
		prefix = "sh"
	}
	code := prefix + pureSymbol

	// 腾讯代理接口：支持 500 条 K 线及前复权
	url := fmt.Sprintf("https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?_var=kline_day&param=%s,day,,,1100,qfq", code)
	
	resp, err := http.Get(url)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	content := string(body)

	// 处理 JSONP 格式
	if strings.Contains(content, "=") {
		content = content[strings.Index(content, "=")+1:]
	}

	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return nil, nil, fmt.Errorf("解析失败: %v", err)
	}

	data, _ := raw["data"].(map[string]interface{})
	stockData, ok := data[code].(map[string]interface{})
	if !ok {
		return nil, nil, fmt.Errorf("股票代码 %s 无数据", symbol)
	}

	// 优先取前复权数据 qfqday
	var klines []interface{}
	if qfq, ok := stockData["qfqday"].([]interface{}); ok {
		klines = qfq
	} else {
		klines, _ = stockData["day"].([]interface{})
	}

	var dates []string
	var closes []float64
	for _, k := range klines {
		line, _ := k.([]interface{})
		if len(line) < 3 { continue }

		// line[0] 是日期, line[2] 是收盘价
		dateVal := strings.ReplaceAll(line[0].(string), "-", "")
		priceVal, _ := strconv.ParseFloat(line[2].(string), 64)
		
		dates = append(dates, dateVal)
		closes = append(closes, priceVal)
	}

	if len(dates) == 0 {
		return nil, nil, fmt.Errorf("未找到有效 K 线数据")
	}

	return dates, closes, nil
}

// RunBacktest 函数保持不变...
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

	if logs == nil { logs = []TradeLog{} }
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
