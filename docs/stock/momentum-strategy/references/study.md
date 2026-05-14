> 说明：当前脚本实现已经切换为“绝对得分”口径，不再做滚动标准化，而是直接对趋势、动量、量能三个原始分量加权求和。下文保留为策略研究说明和早期原型参考。

#### 1. 趋势强度：寻找稳稳的幸福

一只优秀的ETF，其价格走势应该是稳健而持续的。模型如何衡量“趋势”？这里引入了数学中的线性回归。

系统会截取指定日期前一段时间的收盘价数据，对其取对数后进行线性回归分析，得出两个关键值：**斜率**和**R²（决定系数）**。

- **斜率**

  代表了价格的平均上涨速度。我们将其年化，以便于比较。

- **R²**

  则衡量了价格走势的“线性”程度，R²越接近1，说明价格越贴近一条稳定的上升直线，波动越小。

**趋势强度得分 = 年化斜率 × R²**。这个得分越高，意味着该ETF不仅涨得快，而且涨得稳，是那种让人安心的“慢牛”走势。

#### 2. 动量得分：捕捉短期的爆发力

如果说趋势强度是考察长期耐力，那么动量得分就是衡量短期爆发力。市场情绪的转变往往体现在近期的价格变化上。

模型综合考虑了**5日收益率**和**10日收益率**，并赋予它们不同的权重（默认为60%和40%）。**动量得分 = 0.6 × 5日收益率 + 0.4 × 10日收益率**。

这个设计能够灵敏地捕捉到市场短期热点和资金流向。当一只ETF的动量得分迅速攀升时，可能意味着它正在成为市场关注的焦点。

#### 3. 量能指标：确认趋势的“含金量”

价格的变化必须有成交量的配合才值得信赖。没有成交量支撑的上涨，如同空中楼阁，随时可能坍塌。因此，将“量能”作为评估的重要一环。

系统通过计算**短期成交量均值（5日）与长期成交量均值（20日）的比率，并取对数**，来得出量能指标。**量能指标 = ln(短期成交量均值 / 长期成交量均值)**。

当这个指标为正且数值较大时，说明近期的交投活跃度显著高于过去平均水平，资金正在积极涌入，为当前的趋势提供了坚实的“燃料”。

#### 综合评分：你的定制化决策依据

最后，系统将上述三个核心因子按照一定的权重（默认为40%、35%、25%）进行加权汇总，得出最终的**综合评分**。



```
import streamlit as st
import tushare as ts
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from scipy import stats
from datetime import datetime, timedelta
import os
# Tushare API配置
TS_TOKEN = "xxxxx"
# 初始化Tushare API
ts.set_token(TS_TOKEN)
pro = ts.pro_api()
# 初始化ETF数据
ETF_DATABASE = {
    "上证50ETF":"510050.SH",
    "沪深300ETF": "510300.SH",
    "创50ETF": "159681.SZ",
    "科创50ETF": "588000.SH",
    "中证500ETF": "510500.SH",
    "纳斯达克100指数ETF": "159513.SZ",
    "港股互联网ETF": "513770.SH",
    "港股创新药ETF": "513120.SH",
    "科创芯片50ETF": "588200.SH",
    "光伏ETF": "515790.SH",
    "黄金ETF": "518880.SH",
    "军工ETF": "512710.SH",
    "煤炭ETF": "515220.SH",
    "白酒ETF": "512690.SH",
    # "半导体ETF": "512480.SH",
    # "半导体材料ETF": "562590.SH",
    "半导体设备ETF": "159516.SZ",
    # "化工ETF": "516120.SH",
    # "通信ETF": "515880.SH",
    "5G通信ETF": "515050.SH",
    # "人工智能ETF": "515980.SH",
    "银行ETF": "512800.SH",
    "基建50ETF": "516970.SH",
    "证券ETF": "512880.SH",
    "机器人ETF": "562500.SH",
    # "现金流ETF": "159399.SZ",
    "消费ETF": "159928.SZ",
    # "红利低波ETF": "512890.SH",
    #"消费电子ETF": "159732.SZ",
    "养殖ETF": "159865.SZ",
    "游戏ETF": "159869.SZ",
    "电池ETF": "159755.SZ",
    "传媒ETF": "512980.SH",
    # "新能源ETF": "159875.SZ",
    "医疗器械ETF": "159883.SZ",
    "稀土ETF": "516780.SH",
    "黄金股票ETF": "159562.SZ"
}
# 动量得分计算模型
@st.cache_data(ttl=600)  # 缓存10分钟
def calculate_momentum_scores(df, date, trend_window=25):
    """
    计算ETF三大核心因子得分
    :param df: 包含OHLCV数据的DataFrame
    :param date: 指定评估日期
    :return: 字典格式的评分结果
    """
    # 筛选指定日期前的数据日期
    df_sub = df[df.index <= date].iloc[-trend_window * 2:]
    if len(df_sub) < trend_window:
        return {"错误": "数据不足"}
    # 1. 趋势强度因子（线性回归斜率+R²）
    x = np.arange(len(df_sub))
    y = np.log(df_sub['close'])
    slope, _, r_value, _, _ = stats.linregress(x, y)
    trend_score = (slope * 250) * (r_value ** 2)  # 年化斜率×R平方
    # 2. 动量因子（5日+10日收益率）
    roc_5 = (df_sub['close'].iloc[-1] / df_sub['close'].iloc[-6] - 1) * 100
    roc_10 = (df_sub['close'].iloc[-1] / df_sub['close'].iloc[-11] - 1) * 100
    momentum_score = 0.6 * roc_5 + 0.4 * roc_10  # 短期动量加权
    # 3. 量能因子（成交量均线比）
    vol_ma_short = df_sub['volume'].rolling(5).mean().iloc[-1]
    vol_ma_long = df_sub['volume'].rolling(20).mean().iloc[-1]
    volume_score = np.log(vol_ma_short / vol_ma_long) if vol_ma_long > 0 else 0
    # 综合得分（归一化到0-100分）
    total_score = 40 * trend_score + 35 * momentum_score + 25 * volume_score
    return {
        '趋势强度': round(trend_score, 2),
        '动量得分': round(momentum_score, 2),
        '量能指标': round(volume_score, 2),
        '综合评分': max(0, min(100, round(total_score, 2)))
    }
# 获取历史数据（Tushare接口）
@st.cache_data(ttl=600)
def fetch_etf_data_ts(symbol, start_date, end_date):
    """使用Tushare获取ETF历史数据"""
    try:
        # 获取ETF日线数据
        df = pro.fund_daily(ts_code=symbol,
                            start_date=start_date.replace('-', ''),
                            end_date=end_date.replace('-', ''))
        if df.empty:
            st.warning(f"未获取到 {symbol} 的数据")
            return pd.DataFrame()
        # 列名标准化处理
        df = df.rename(columns={
            'trade_date': 'date',
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'vol': 'volume'
        })
        # 日期处理
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        # 按日期排序
        df = df.sort_index()
        return df
    except Exception as e:
        st.error(f"数据获取失败: {str(e)}")
        return pd.DataFrame()
# 使用Plotly生成K线图
def generate_plotly_chart(df, days=60):
    """生成带移动平均线的K线图（使用Plotly）"""
    df = df.tail(days).copy()
    # 确保数据格式正确
    if 'close' not in df.columns:
        st.error("数据格式错误，缺少'close'列")
        return None
    # 计算移动平均线
    df['MA5'] = df['close'].rolling(5).mean()
    df['MA20'] = df['close'].rolling(20).mean()
    # 创建子图：主图为K线图，副图为成交量
    fig = make_subplots(
        rows=2, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.1,
        row_heights=[0.7, 0.3],
        specs=[[{"secondary_y": True}], [{"secondary_y": False}]]
    )
    # 添加K线图
    fig.add_trace(
        go.Candlestick(
            x=df.index,
            open=df['open'],
            high=df['high'],
            low=df['low'],
            close=df['close'],
            name='K线',
            increasing_line_color='#ef5350',  # 上涨红色
            decreasing_line_color='#26a69a'  # 下跌绿色
        ),
        row=1, col=1
    )
    # 添加5日均线
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['MA5'],
            name='5日均线',
            line=dict(color='#1f77b4', width=1.5),
            opacity=0.8
        ),
        row=1, col=1
    )
    # 添加20日均线
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['MA20'],
            name='20日均线',
            line=dict(color='#ff7f0e', width=1.5),
            opacity=0.8
        ),
        row=1, col=1
    )
    # 添加成交量柱状图
    fig.add_trace(
        go.Bar(
            x=df.index,
            y=df['volume'],
            name='成交量',
            marker_color='#7f7f7f',
            opacity=0.6
        ),
        row=2, col=1
    )
    # 设置布局
    fig.update_layout(
        title=f'最近{days}个交易日走势',
        xaxis_title='日期',
        yaxis_title='价格',
        showlegend=True,
        hovermode='x unified',
        template='plotly_white',
        height=600,
        margin=dict(l=50, r=50, t=60, b=50)
    )
    # 设置Y轴标题
    fig.update_yaxes(title_text="价格", row=1, col=1)
    fig.update_yaxes(title_text="成交量", row=2, col=1)
    # 禁用范围选择器（rangeselector）
    fig.update_layout(xaxis_rangeslider_visible=False)
    return fig
# 主应用界面
def app():
    # 页面配置
    # st.set_page_config(
    #     page_title="ETF动量评分系统",
    #     layout="wide",
    #     page_icon="📈"
    # )
    # 标题和说明
    st.title("📊 ETF动量评分与可视化系统")
    st.markdown("本系统通过量化模型评估ETF动量表现，提供投资决策参考")
    # 日期选择器
    max_date = datetime.now()
    selected_date = st.date_input(
        "选择评估日期",
        value=max_date,
        max_value=max_date
    )
    # 获取排序后的ETF列表
    sorted_etf_names = sorted(ETF_DATABASE.keys())
    # ETF多选 - 默认全选
    selected_etfs = st.multiselect(
        "选择ETF",
        options=sorted_etf_names,
        default=sorted_etf_names  # 默认选择所有ETF
    )
    # 高级参数
    with st.expander("高级设置"):
        trend_window = st.slider(
            "趋势计算窗口(日)",
            min_value=20,
            max_value=60,
            value=25
        )
        # 数据范围
        start_date = st.date_input(
            "数据开始日期",
            value=selected_date - timedelta(days=365)
        )
        # 权重调整
        st.markdown("**因子权重调整**")
        trend_weight = st.slider("趋势强度权重", 0, 100, 40)
        momentum_weight = st.slider("动量得分权重", 0, 100, 35)
        volume_weight = st.slider("量能指标权重", 0, 100, 25)
        # 缓存控制
        st.caption(f"当前缓存状态: {len(st.session_state)}")
        if st.button("清除缓存"):
            st.cache_data.clear()
            st.session_state.clear()
            st.rerun()
    # 主内容区
    if st.button("生成分析报告", type="primary", use_container_width=True):
        if not selected_etfs:
            st.warning("请至少选择一个ETF进行分析")
            return
        results = []
        charts = []
        # 遍历选中的ETF
        progress_bar = st.progress(0)
        for i, etf_name in enumerate(selected_etfs):
            progress = (i + 1) / len(selected_etfs)
            progress_bar.progress(progress, text=f"处理 {etf_name}...")
            # 获取数据
            symbol = ETF_DATABASE[etf_name]
            df = fetch_etf_data_ts(symbol, start_date.strftime("%Y-%m-%d"), selected_date.strftime("%Y-%m-%d"))
            if df.empty:
                st.warning(f"{etf_name}({symbol}) 数据获取失败，跳过")
                continue
            # 计算动量得分
            scores = calculate_momentum_scores(df, selected_date.strftime("%Y-%m-%d"), trend_window)
            # 计算当日涨跌幅
            if len(df) >= 2:
                daily_return = (df.iloc[-1]['close'] / df.iloc[-2]['close'] - 1) * 100
            else:
                daily_return = 0.0
            # 动态调整权重
            total_score = (
                    trend_weight * scores["趋势强度"] +
                    momentum_weight * scores["动量得分"] +
                    volume_weight * scores["量能指标"]
            )
            scores["综合评分"] = max(0, min(100, round(total_score, 2)))
            # 添加当日涨跌幅到评分结果
            scores["当日涨跌幅"] = round(daily_return, 2)
            # 生成Plotly图表
            fig = generate_plotly_chart(df)
            # 存储结果
            results.append({
                "ETF": etf_name,
                "代码": symbol,
                **scores
            })
            if fig:
                charts.append(fig)
        progress_bar.empty()
        if not results:
            st.error("所有ETF数据获取失败，请检查网络连接或Tushare Token")
            return
        # 展示评分结果表格
        st.subheader("📝 ETF动量评分结果")
        df_results = pd.DataFrame(results)
        # 按照综合评分排序
        #df_results = df_results.sort_values(by="综合评分", ascending=False)
        df_results.sort_values(by=["综合评分", "趋势强度"], ascending=[False, False], inplace=True)
        # 计算推荐权重
        df_results["推荐权重"] = df_results["综合评分"] / df_results["综合评分"].sum()
        # 高亮显示最佳ETF
        def highlight_max(s):
            is_max = s == s.max()
            return ['background-color: #a1d99b' if v else '' for v in is_max]
        # 设置涨跌幅颜色（红涨绿跌）
        def color_return(value):
            if value > 0:
                return 'color: #ef5350'  # 红色
            elif value < 0:
                return 'color: #26a69a'  # 绿色
            return ''
        # 显示表格，添加涨跌幅颜色和格式
        st.dataframe(
            df_results.style
            .apply(highlight_max, subset=["综合评分"])
            .applymap(color_return, subset=['当日涨跌幅'])
            .format({
                "趋势强度": "{:.2f}%",
                "动量得分": "{:.2f}%",
                "量能指标": "{:.2f}",
                "综合评分": "{:.2f}",
                "推荐权重": "{:.2%}",
                "当日涨跌幅": "{:.2f}%"
            }),
            height=min(600, 45 * len(df_results))
        )
        # 展示Plotly图表
        if charts:
            st.subheader("📈 K线趋势分析 (交互式图表)")
            # 创建一个映射，将ETF名称与图表关联
            etf_chart_map = {etf: chart for etf, chart in zip(selected_etfs, charts)}
            # 按照评分排序展示图表
            for etf_name in df_results["ETF"]:
                if etf_name in etf_chart_map:
                    st.plotly_chart(etf_chart_map[etf_name], use_container_width=True)
                    st.caption(f"{etf_name} 技术图表（最近60个交易日）")
        # 数据导出选项
        st.divider()
        col1, col2 = st.columns(2)
        with col1:
            st.download_button(
                label="下载评分数据(CSV)",
                data=df_results.to_csv(index=False).encode("utf-8"),
                file_name=f"etf_scores_{selected_date}.csv",
                mime="text/csv"
            )
        with col2:
            if st.button("查看实时行情", use_container_width=True):
                try:
                    # 使用Tushare获取实时行情
                    df_realtime = pro.fund_daily(trade_date=datetime.now().strftime('%Y%m%d'))
                    st.dataframe(
                        df_realtime[["ts_code", "trade_date", "close", "pct_chg", "vol"]]
                        .rename(columns={
                            "ts_code": "代码",
                            "trade_date": "日期",
                            "close": "收盘价",
                            "pct_chg": "涨跌幅",
                            "vol": "成交量"
                        })
                        .sort_values("涨跌幅", ascending=False)
                        .head(10)
                    )
                except Exception as e:
                    st.error(f"实时行情获取失败: {str(e)}")
# 应用入口
if __name__ == "__main__":
    app()
```

