# 动量策略参数

本策略把趋势、价格动量、成交量确认三个原始指标先做滚动分位数标准化，再输出每天的 JSON 分数。

## 输入

- 日收盘价。
- 日成交量，来自 Tushare 的 `vol` 字段。
- 趋势滚动窗口：默认 `20` 个交易日。
- 价格动量窗口：默认短窗口 `5` 个交易日，长窗口 `10` 个交易日。
- 标准化窗口：默认 `252` 个交易日，最少 `60` 个有效样本后开始输出标准化分数。
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

## 标准化

每个原始指标都会在最近 `normalization_window` 个有效样本内计算滚动分位数，并映射到 `0-200`：

```text
normalized_score = rolling_percentile(raw_score) * 200
```

含义：

- `100`：该指标处于自身最近窗口内的中位水平。
- `>100`：强于自身历史常态。
- `<100`：弱于自身历史常态。

滚动分位数只使用当天及以前的数据，避免未来函数。

## 总分

```text
total_score_raw =
  (trend_weight * trend_score
   + momentum_weight * momentum_score
   + volume_weight * volume_score)
  / (trend_weight + momentum_weight + volume_weight)

total_score = total_score_raw
```

如果任一标准化组件为 `null`，`total_score_raw` 为 `null`，`total_score` 为 `0`。

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
- `trend_score`：滚动分位数标准化后的趋势分，范围约 `0-200`。
- `momentum_score`：滚动分位数标准化后的价格动量分，范围约 `0-200`。
- `volume_score`：滚动分位数标准化后的成交量分，范围约 `0-200`。
- `total_score_raw`：标准化后的加权平均总分。
- `total_score`：前端展示使用的总分。
