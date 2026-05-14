# 动量策略参数

本策略直接使用趋势、价格动量、成交量确认三个原始指标，并按权重加权求和计算每天的绝对得分，输出为 JSON。

## 输入

- 日收盘价。
- 日成交量，来自 Tushare 的 `vol` 字段。
- 趋势滚动窗口：默认 `20` 个交易日。
- 价格动量窗口：默认短窗口 `5` 个交易日，长窗口 `10` 个交易日。
- 权重：趋势 `40`、动量 `35`、成交量 `25`。

## 原始指标

### 趋势

对最近 `window` 个交易日：

1. 使用 `y = log(close)`。
2. 使用 `x = 0, 1, 2, ... window-1`。
3. 对 `x` 和 `y` 做一元线性回归，得到斜率 `b`。
4. 计算 `R^2 = corr(x, y)^2`。如果价格不波动或相关系数无法定义，则取 `0`。
5. `trend_raw_score = (b * 250) * R^2`。
6. `b_times_r_squared = b * R^2`。

### 价格动量

默认：

```text
roc_short = (close_t / close_t-5 - 1) * 100
roc_long  = (close_t / close_t-10 - 1) * 100
momentum_raw_score = 0.6 * roc_short + 0.4 * roc_long
```

`5` 和 `10` 可以通过 `--momentum-short-window`、`--momentum-long-window` 配置。

### 成交量确认

```text
vol_ma_short = 最近 5 个交易日成交量均值
vol_ma_long  = 最近 20 个交易日成交量均值
volume_raw_score = log(vol_ma_short / vol_ma_long)
```

如果两个均值没有同时大于 `0`，则取 `0`。

## 直接计分

本版本不再对三个原始指标做滚动分位数标准化：

- `trend_score = trend_raw_score`
- `momentum_score = momentum_raw_score`
- `volume_score = volume_raw_score`

也就是说，输出分数是原始量纲上的绝对值，而不是相对于过去一段历史窗口的位置分数。

## 总分

```text
total_score_raw =
  trend_weight * trend_score
  + momentum_weight * momentum_score
  + volume_weight * volume_score

total_score = total_score_raw
```

如果任一组件为 `null`，`total_score_raw` 为 `null`，`total_score` 为 `0`。

## JSON 每日字段

- `date`：交易日，格式 `YYYY-MM-DD`。
- `close`：收盘价，保留 4 位小数。
- `volume`：Tushare 原始成交量值。
- `b`：滚动窗口内 `log(close)` 的回归斜率。
- `r_squared`：趋势拟合质量。
- `b_times_r_squared`：`b * R^2`。
- `trend_raw_score`：未标准化趋势原始值。
- `momentum_raw_score`：未标准化价格动量原始值。
- `volume_raw_score`：未标准化成交量原始值。
- `legacy_total_score_raw`：旧算法的原始量纲加权值，仅用于对照。
- `trend_score`：直接等于 `trend_raw_score`。
- `momentum_score`：直接等于 `momentum_raw_score`。
- `volume_score`：直接等于 `volume_raw_score`。
- `total_score_raw`：三个原始分量按权重计算得到的加权求和总分。
- `total_score`：前端展示使用的总分。
- `score_ma20`：总分的 20 日移动平均，仅在样本足够时输出。
- `score_ma60`：总分的 60 日移动平均，仅在样本足够时输出。
