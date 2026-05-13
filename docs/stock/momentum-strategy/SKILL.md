---
name: momentum-strategy
description: 为单只 A 股、ETF 或基金按指定时间范围导出动量策略每日指标。适用于用户提供股票/基金代码、开始日期和结束日期，并希望复用 stock/Test/gen_img.py 的策略逻辑，输出收盘价、趋势分、动量分、成交量分、总加权分等每日 JSON 数据。
---

# 动量策略

使用这个 skill 计算 `stock/Test/gen_img.py` 里的滚动动量策略，并把每日结果保存为 JSON。

## 核心流程

1. 将股票或基金代码规范化为 Tushare `ts_code` 格式。若用户已提供后缀则保留；否则 `5` 或 `6` 开头补 `.SH`，`4` 或 `8` 开头补 `.BJ`，其余默认补 `.SZ`。
2. 明确开始日期和结束日期。除非用户接受默认值，不要省略时间范围。
3. 用代码、日期范围和 Tushare token 运行 `scripts/export_momentum_scores.py`。
4. 返回 JSON 文件路径，并简要说明行数、日期覆盖范围、滚动窗口和数据来源。

示例：

```bash
python scripts/export_momentum_scores.py --ts-code 159681.SZ --start-date 2025-01-01 --end-date 2025-12-31 --token YOUR_TUSHARE_TOKEN --output ./159681_momentum.json
```

如果 Windows 上通过 `py` 启动 Python：

```bash
py -3 scripts/export_momentum_scores.py --ts-code 159681.SZ --start-date 2025-01-01 --end-date 2025-12-31 --token YOUR_TUSHARE_TOKEN --output ./159681_momentum.json
```

## 数据来源

脚本默认使用 Tushare。优先通过 `--token` 显式传入 token；如果没有传入，则依次尝试环境变量 `TUSHARE_TOKEN` 和 Tushare 本地保存的 token。不要把真实 token 写进文档、日志或 JSON 结果。

默认使用 `--asset-type auto`：ETF/基金风格代码优先尝试 `fund_daily`，股票风格代码优先尝试 `daily`。

如果要离线计算，传入 `--input-csv path/to/file.csv`。CSV 必须包含 `date` 或 `trade_date`、`close`，以及 `volume` 或 `vol`。

## 策略细节

需要公式和输出结构时，读取 `references/strategy.md`。

默认参数与源脚本保持一致：

- `--window 20`
- `--trend-weight 40`
- `--momentum-weight 35`
- `--volume-weight 25`

脚本会在用户要求的开始日期之前额外拉取一段 warmup 历史数据，这样只要前置交易日足够，起始日期附近也可以计算滚动窗口分数。最终 JSON 里的 `records` 会过滤回用户请求的日期范围。

## 输出约定

保存一个 JSON 文件，包含：

- `metadata`：代码、请求日期、实际日期、数据接口、token 来源、滚动窗口、权重、行数和生成时间。
- `records`：每个交易日一个对象，包含 `date`、`close`、`volume`、`b`、`r_squared`、`b_times_r_squared`、`trend_score`、`momentum_score`、`volume_score`、`total_score_raw` 和 `total_score`。

不要把这些分数表述为投资建议。它们只是由历史收盘价和成交量派生出来的研究特征。
