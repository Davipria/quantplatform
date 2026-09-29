"""Zero-shot forecasting with Google's TimesFM 3.0 (github.com/google-research/timesfm), shared by the stock-price forecast
(Overview tab) and the macro-series forecast (Macro tab, see `macro.forecast`).

The model needs no training or fine-tuning for a new series: it is fed recent values as "context" and predicts the next
`horizon` steps directly, at whatever spacing the context already has (daily closes, weekly yields, monthly CPI...). Code is
Apache-2.0; the published weights are under Google's "TimesFM Non-Commercial License v1.0" (no production/commercial use) --
fine here since this platform is for internal use only, per the owner (2026-09-28).

Runs on CPU (no GPU on this machine): the model (~0.3B parameters) is lazy-loaded on first use (shared by every caller, so it
is only loaded once), which also downloads the checkpoint from Hugging Face (huggingface_hub caches it under the user's home
directory, so this only happens once). A single forecast then takes well under a second on CPU.
"""
import threading

import numpy as np
import pandas as pd
from cachetools.func import ttl_cache

import seasonality
from data import DataError

HORIZON_MAX = 90
CONTEXT_DAYS = 512  # recent trading days fed as context; more history barely changes a zero-shot forecast and stays fast on CPU

_lock = threading.RLock()  # reentrant: extrapolate() holds it around predict_batch while _model() may also need it to load
_evaluator = None


def _model():
    global _evaluator
    if _evaluator is None:
        with _lock:
            if _evaluator is None:
                from timesfm3 import ModelConfig, TimesFM3Evaluator
                _evaluator = TimesFM3Evaluator(ModelConfig(checkpoint_path="google/timesfm-3.0-pytorch", device="cpu"))
    return _evaluator


def extrapolate(values: list[float], horizon: int) -> dict:
    """Zero-shot point forecast plus a 10th-90th percentile band, `horizon` steps beyond the last value of `values` (whatever
    that series' own step is -- a day, a week, a month). Not a signal -- a statistical extrapolation of the recent pattern,
    with no knowledge of what the series actually measures."""
    context = np.asarray(values, dtype=np.float32)
    try:
        with _lock:
            [output] = list(_model().predict_batch([context], horizon=horizon, return_quantiles=True))
    except Exception as e:  # noqa: BLE001  (first call also downloads the checkpoint; surface any failure as a clean 502)
        raise DataError(502, f"Forecast model error: {e}") from e
    q = np.asarray(output.quantiles)  # (horizon, 9): the 10th .. 90th percentile, in order
    return {
        "forecast": [round(float(v), 4) for v in output.forecast],
        "low": [round(float(v), 4) for v in q[:, 0]],
        "high": [round(float(v), 4) for v in q[:, -1]],
    }


@ttl_cache(maxsize=64, ttl=3600)
def price_forecast(symbol: str, horizon: int = 30) -> dict:
    """Zero-shot forecast of the daily close, `horizon` trading days (approximated as weekdays) beyond the last close."""
    horizon = max(1, min(int(horizon), HORIZON_MAX))
    df, meta = seasonality._prices(symbol)
    close = df.Close.dropna()
    if len(close) < 30:
        raise DataError(422, f"Not enough price history for {symbol} to forecast")
    out = extrapolate(close.iloc[-CONTEXT_DAYS:].tolist(), horizon)
    dates = pd.bdate_range(close.index[-1] + pd.Timedelta(days=1), periods=horizon)
    return {
        "symbol": symbol, "currency": meta["currency"], "lastDate": close.index[-1].strftime("%Y-%m-%d"),
        "lastClose": round(float(close.iloc[-1]), 4), "dates": [d.strftime("%Y-%m-%d") for d in dates], **out,
    }


def extrapolate_joint(series_list: list[list[float]], horizon: int) -> list[dict]:
    """Joint multivariate zero-shot forecast (TimesFM 3's actual multivariate mode): the series are forecast TOGETHER as
    related variates, so their correlation in the context can inform each other's projection -- unlike calling `extrapolate`
    on each series alone. All series must be the same length. Returns one {"forecast","low","high"} per input series, same
    order."""
    target = np.array(series_list, dtype=np.float32)  # (num_variates, context_length)
    try:
        with _lock:
            [output] = list(_model().predict_batch(contexts=[target], horizon=horizon, return_quantiles=True))
    except Exception as e:  # noqa: BLE001
        raise DataError(502, f"Forecast model error: {e}") from e
    fc, q = np.asarray(output.forecast), np.asarray(output.quantiles)  # (variates, horizon), (variates, horizon, 9)
    return [
        {"forecast": [round(float(v), 4) for v in fc[i]], "low": [round(float(v), 4) for v in q[i, :, 0]], "high": [round(float(v), 4) for v in q[i, :, -1]]}
        for i in range(len(series_list))
    ]


MARKET_SYMBOL = "^GSPC"


@ttl_cache(maxsize=32, ttl=3600)
def market_forecast(symbol: str, horizon: int = 30) -> dict:
    """The same daily-close forecast as `price_forecast` ("solo"), alongside a second forecast made JOINTLY with the S&P 500
    ("withMarket") -- both series are fed to the model together as two related variates, so the market's recent pattern can
    shape the stock's projection too. Both series are rebased to 100 at the start of the shared context before forecasting
    (their price scales and currencies otherwise differ, e.g. a EUR stock against the USD index; only relative moves matter
    to the model), then the stock's path is scaled back to its own price. The gap between the two shows how much accounting
    for the market changes the picture -- not which one is "right"."""
    horizon = max(1, min(int(horizon), HORIZON_MAX))
    df, meta = seasonality._prices(symbol)
    stock = df.Close.dropna()
    mkt = seasonality._prices(MARKET_SYMBOL)[0].Close.dropna()
    common = stock.index.intersection(mkt.index)[-CONTEXT_DAYS:]
    if len(common) < 60:
        raise DataError(422, f"Not enough overlapping history for {symbol} and the S&P 500 to forecast")
    s, m = stock.loc[common], mkt.loc[common]
    solo = extrapolate(s.tolist(), horizon)
    s_re, m_re = (s / s.iloc[0] * 100).tolist(), (m / m.iloc[0] * 100).tolist()
    stock_joint, _mkt_joint = extrapolate_joint([s_re, m_re], horizon)
    scale = float(s.iloc[0]) / 100  # reverses the "/ s.iloc[0] * 100" rebasing above
    with_market = {k: [round(v * scale, 4) for v in stock_joint[k]] for k in ("forecast", "low", "high")}
    dates = pd.bdate_range(common[-1] + pd.Timedelta(days=1), periods=horizon)
    return {
        "symbol": symbol, "currency": meta["currency"], "lastDate": common[-1].strftime("%Y-%m-%d"),
        "lastClose": round(float(s.iloc[-1]), 4), "dates": [d.strftime("%Y-%m-%d") for d in dates],
        "solo": solo, "withMarket": with_market,
    }
