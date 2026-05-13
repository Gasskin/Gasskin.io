# 动量策略参考

本策略来自 `stock/Test/gen_img.py`，这里将原来的图表输出整理为按交易日输出 JSON 的计算说明。

## 输入

- 日收盘价。
- 日成交量，来自 Tushare 的 `vol` 字段。
- 滚动窗口，默认 `20` 个交易日。
- 权重：趋势 `40`、动量 `35`、成交量 `25`。

## 每日公式

对每个交易日 `t`，使用截至当天的最近 `window` 个交易日收盘价和成交量。

### 趋势

1. 在滚动窗口内令 `y = log(close)`。
2. 令 `x = 0, 1, 2, ... window-1`。
3. 对 `x` 和 `y` 做一元线性回归，取斜率 `b`。
4. 计算 `R^2 = corr(x, y)^2`。如果价格不波动或相关系数无法定义，则取 `0`。
5. `trend_score = (b * 250) * R^2`。
6. `b_times_r_squared = b * R^2`。

### 价格动量

如果窗口内至少有 11 个收盘价：

- `roc_5 = (close_t / close_t-5 - 1) * 100`
- `roc_10 = (close_t / close_t-10 - 1) * 100`
- `momentum_score = 0.6 * roc_5 + 0.4 * roc_10`

否则该值为 `null`。

### 成交量

成交量分数用于衡量近期成交活跃度是否相对放大。它不直接判断价格方向，而是用“短期成交量均值相对长期成交量均值”的变化来确认市场参与度。

如果窗口内至少有 20 个成交量：

- `vol_ma_short = 最近 5 个交易日成交量均值`
- `vol_ma_long = 最近 20 个交易日成交量均值`
- 当两个均值都大于 0 时，`volume_score = log(vol_ma_short / vol_ma_long)`；否则取 `0`

逻辑解释：

- 当最近 5 日均量大于最近 20 日均量时，比值大于 `1`，取对数后为正，表示近期成交活跃度放大。
- 当最近 5 日均量小于最近 20 日均量时，比值小于 `1`，取对数后为负，表示近期成交活跃度萎缩。
- 使用 `log` 可以让放大和萎缩更对称。例如放大到 2 倍约为 `+0.693`，缩小到 1/2 约为 `-0.693`。

如果窗口内不足 20 个成交量，则该值为 `null`。

### 总分

```text
total_score_raw =
  trend_weight * trend_score
  + momentum_weight * momentum_score
  + volume_weight * volume_score

total_score = max(0, total_score_raw)
```

如果任一组件为 `null`，`total_score_raw` 为 `null`，`total_score` 为 `0`。

## JSON 每日字段

- `date`：交易日，格式 `YYYY-MM-DD`。
- `close`：收盘价，保留 4 位小数。
- `volume`：Tushare 原始成交量值。
- `b`：滚动窗口内 `log(close)` 的回归斜率。
- `r_squared`：趋势拟合质量。
- `b_times_r_squared`：`b * R^2`。
- `trend_score`：年化斜率乘以 `R^2`。
- `momentum_score`：5 日和 10 日收益率变化的加权结果。
- `volume_score`：短期成交量均值与长期成交量均值比值的对数。
- `total_score_raw`：未做下限处理前的加权总分。
- `total_score`：经过 `max(0, raw)` 处理后的非负总分。
