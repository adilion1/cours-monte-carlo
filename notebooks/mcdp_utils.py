"""Shared toolbox for the course *Optimisation dynamique et simulations de Monte Carlo en Python*
(M2 Finance, 7 sessions of 3 h).

Every notebook of `cours/seanceXX/` imports the objects defined here instead of
redefining them, so that notation, the Monte Carlo output interface and the
red-thread data set stay identical from session 1 to session 7.

The module is deliberately dependency-light: only ``numpy``, ``scipy``,
``pandas`` and ``matplotlib``.  It has no side effect at import time
(``set_style`` must be called explicitly) and no function prints, with the
single exception of the notebook self-correction triptych of the v2 course
(``verifier``, ``indice``, ``solution``), whose whole purpose is to print.

Contents
--------
Monte Carlo output interface
    :class:`MCResult`, :func:`mc_estimate`, :class:`Timer`.
Closed-form Black-Scholes
    :func:`black_scholes`, :func:`black_scholes_greeks`.
Simulation of Brownian motion and geometric Brownian motion
    :func:`simulate_brownian`, :func:`simulate_gbm_terminal`,
    :func:`simulate_gbm_terminal_q`, :func:`simulate_gbm_terminal_p`,
    :func:`simulate_gbm_paths`.
Sanity checks and pricers
    :func:`martingale_check`, :func:`price_european_mc`,
    :func:`price_asian_mc`.
Binomial tree, closed forms, path-dependent helpers (S3 to S7)
    :func:`crr_option`, :func:`crr_american_put`,
    :func:`asian_geometric_closed_form`,
    :func:`brownian_bridge_crossing_prob`, :func:`perpetual_put`.
Red-thread data set
    :func:`load_prices`, :func:`load_returns`, :func:`load_rates`,
    :func:`load_vix`, :func:`annualize_stats`, :func:`portfolio_returns`,
    :data:`PORTFOLIO_WEIGHTS`, :data:`REFERENCE_PARAMS`.
Plotting
    :func:`set_style`.
Functions *given* to the beginner of the v2 course (``00_ARCHITECTURE.md`` 1.4)
    :func:`charger_fil_rouge`, :func:`vol_portefeuille`,
    :func:`black_scholes_call`, :func:`black_scholes_put`, :func:`simuler_ST`,
    :func:`payoff_call`, :func:`payoff_put`, :func:`verifier`,
    :func:`indice`, :func:`solution`.  French names, English docstrings, numpy
    in and numpy out: no pandas object crosses that interface.

Conventions (see ``cours/NOTATION.md``)
---------------------------------------
* Rates and volatilities are decimals (0.17, not 17).
* Maturities ``T`` are in years; daily data are annualised with 252 trading days.
* Paths have shape ``(n_paths, n_steps + 1)`` and column 0 holds ``S0``.
* Randomness always comes from an explicit ``numpy.random.Generator``
  (``np.random.default_rng(SEED)``); ``np.random.seed`` is never used.
* No array larger than ``MAX_ARRAY_ELEMENTS`` (1e7 float64 ~ 80 MB) is
  allocated; beyond that, loop over blocks (see :func:`price_european_mc`).
"""

from __future__ import annotations

import os
import time
from functools import lru_cache
from pathlib import Path
from types import TracebackType
from typing import Mapping, NamedTuple, Sequence

import matplotlib as mpl
import numpy as np
import pandas as pd
from scipy.stats import norm

__all__ = [
    "MAX_ARRAY_ELEMENTS",
    "PORTFOLIO_WEIGHTS",
    "REFERENCE_PARAMS",
    "MCResult",
    "Timer",
    "annualize_stats",
    "asian_geometric_closed_form",
    "black_scholes",
    "black_scholes_call",
    "black_scholes_greeks",
    "black_scholes_put",
    "brownian_bridge_crossing_prob",
    "charger_fil_rouge",
    "crr_american_put",
    "crr_option",
    "indice",
    "load_prices",
    "load_rates",
    "load_returns",
    "load_vix",
    "martingale_check",
    "mc_estimate",
    "payoff_call",
    "payoff_put",
    "perpetual_put",
    "portfolio_returns",
    "price_asian_mc",
    "price_european_mc",
    "set_style",
    "simulate_brownian",
    "simulate_gbm_paths",
    "simulate_gbm_terminal",
    "simulate_gbm_terminal_p",
    "simulate_gbm_terminal_q",
    "simuler_ST",
    "solution",
    "verifier",
    "vol_portefeuille",
]

# Memory convention of NOTATION.md section 12: never allocate an array of more
# than 1e7 float64 elements (about 80 MB).  Functions that could exceed it
# either refuse (simulate_*) or loop over blocks (price_european_mc).
MAX_ARRAY_ELEMENTS: int = 10_000_000


# ---------------------------------------------------------------------------
# 1. Monte Carlo output interface (NOTATION.md section 12)
# ---------------------------------------------------------------------------


class MCResult(NamedTuple):
    """Result of a Monte Carlo estimation.

    Attributes
    ----------
    mean : float
        Point estimate ``\\hat{theta}_N`` (a random variable, not the exact value).
    se : float
        Standard error ``SE_N = \\hat{sigma}_N / sqrt(N)``.
    ci_low, ci_high : float
        Bounds of the two-sided normal confidence interval.
    n : int
        Number of i.i.d. samples actually used.
    seconds : float
        Wall-clock time of the simulation only (no data loading, no plotting).
    """

    mean: float  # \hat{theta}_N
    se: float  # SE_N = \hat{sigma}_N / sqrt(N)
    ci_low: float  # mean - z * se
    ci_high: float  # mean + z * se
    n: int  # number of i.i.d. samples actually used
    seconds: float  # wall-clock time of the simulation only

    def __str__(self) -> str:
        """Human-readable one-liner, e.g. ``9.8116 +/- 0.0452 (IC 95 %) ; N = 100000 ; 0.34 s``.

        The confidence level is not stored in the tuple; it is recovered from
        the half-width and the standard error, ``level = 2 * Phi(half / se) - 1``.
        """
        half = 0.5 * (self.ci_high - self.ci_low)
        if self.se > 0 and np.isfinite(half):
            level = 2.0 * float(norm.cdf(half / self.se)) - 1.0
            pct = 100.0 * level
            level_txt = f"{pct:.0f}" if abs(pct - round(pct)) < 0.05 else f"{pct:.1f}"
            ci_txt = f"(IC {level_txt} %)"
        else:  # degenerate sample (zero variance, or n = 1)
            ci_txt = "(IC n/a)"
        return (
            f"{self.mean:.4f} +/- {half:.4f} {ci_txt} ; "
            f"N = {self.n} ; {self.seconds:.2f} s"
        )


def mc_estimate(samples: np.ndarray, seconds: float, level: float = 0.95) -> MCResult:
    """Summarise i.i.d. samples into an :class:`MCResult` (two-sided normal CI at `level`).

    Parameters
    ----------
    samples : array_like
        The i.i.d. draws ``Y^(1), ..., Y^(N)`` whose mean estimates ``theta``.
        For a pricer these are the *discounted payoffs*, not the payoffs.
    seconds : float
        Wall-clock time of the simulation, measured with :class:`Timer`.
    level : float, optional
        Confidence level of the interval (default 0.95).

    Returns
    -------
    MCResult

    Notes
    -----
    The interval is the normal (CLT) interval ``mean +/- z * se``; it is valid
    asymptotically only.  With antithetic variates the draws are *not*
    independent: average each pair first, then call this function on the
    ``N / 2`` pair averages, otherwise ``se`` is wrong.
    """
    samples = np.asarray(samples, dtype=float)
    n = samples.size
    mean = samples.mean()
    se = samples.std(ddof=1) / np.sqrt(n)
    z = norm.ppf(0.5 + level / 2)
    return MCResult(float(mean), float(se), float(mean - z * se), float(mean + z * se), int(n), float(seconds))


class Timer:
    """Context manager measuring wall-clock time with :func:`time.perf_counter`.

    Examples
    --------
    >>> with Timer() as tm:
    ...     x = sum(range(1000))
    >>> tm.seconds >= 0.0
    True

    Attributes
    ----------
    seconds : float
        Elapsed time in seconds; while the block is running it holds the time
        elapsed so far, after the block it is frozen.
    """

    __slots__ = ("_t0", "_t1")

    def __init__(self) -> None:
        self._t0: float | None = None
        self._t1: float | None = None

    def __enter__(self) -> "Timer":
        self._t1 = None
        self._t0 = time.perf_counter()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._t1 = time.perf_counter()

    @property
    def seconds(self) -> float:
        """Elapsed wall-clock time in seconds (0.0 before the block is entered)."""
        if self._t0 is None:
            return 0.0
        end = self._t1 if self._t1 is not None else time.perf_counter()
        return end - self._t0

    def __float__(self) -> float:
        return self.seconds

    def __repr__(self) -> str:
        return f"Timer(seconds={self.seconds:.4f})"


# ---------------------------------------------------------------------------
# 2. Closed-form Black-Scholes
# ---------------------------------------------------------------------------


def _as_float_arrays(*values: object) -> tuple[np.ndarray, ...]:
    """Broadcast every argument to a common shape as float64 arrays."""
    arrays = [np.asarray(v, dtype=float) for v in values]
    return tuple(np.broadcast_arrays(*arrays)) if len(arrays) > 1 else (arrays[0],)


def _unwrap(x: np.ndarray) -> float | np.ndarray:
    """Return a Python float for 0-d arrays, the array itself otherwise."""
    x = np.asarray(x)
    return float(x) if x.ndim == 0 else x


def _check_kind(kind: str) -> str:
    kind = str(kind).lower()
    if kind not in ("call", "put"):
        raise ValueError(f"kind must be 'call' or 'put', got {kind!r}")
    return kind


def _bs_d1_d2(
    S0: np.ndarray, K: np.ndarray, T: np.ndarray, r: np.ndarray, sigma: np.ndarray, q: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return ``(d1, d2, vol)`` with ``vol = sigma * sqrt(T)``, handling ``vol = 0``.

    When ``sigma * sqrt(T) = 0`` the option value degenerates to its discounted
    intrinsic value; we set ``d1 = d2 = +/- inf`` according to the sign of
    ``log(F / K)`` with ``F = S0 exp((r - q) T)``, so that the usual formula
    still returns the right limit (``Phi(+inf) = 1``, ``Phi(-inf) = 0``).
    """
    if np.any(S0 <= 0) or np.any(K <= 0):
        raise ValueError("S0 and K must be strictly positive")
    if np.any(T < 0) or np.any(sigma < 0):
        raise ValueError("T and sigma must be non-negative")

    vol = sigma * np.sqrt(T)
    log_moneyness_fwd = np.log(S0 / K) + (r - q) * T  # log(F / K)
    safe_vol = np.where(vol > 0.0, vol, 1.0)
    d1_regular = (log_moneyness_fwd + 0.5 * sigma**2 * T) / safe_vol
    d1_degenerate = np.where(
        log_moneyness_fwd > 0.0, np.inf, np.where(log_moneyness_fwd < 0.0, -np.inf, 0.0)
    )
    d1 = np.where(vol > 0.0, d1_regular, d1_degenerate)
    d2 = np.where(vol > 0.0, d1 - vol, d1)
    return d1, d2, vol


def black_scholes(
    S0: float | np.ndarray,
    K: float | np.ndarray,
    T: float | np.ndarray,
    r: float | np.ndarray,
    sigma: float | np.ndarray,
    q: float | np.ndarray = 0.0,
    kind: str = "call",
) -> float | np.ndarray:
    """Black-Scholes-Merton price of a European call or put with continuous dividend yield.

    ``C = S0 exp(-qT) Phi(d1) - K exp(-rT) Phi(d2)`` and
    ``P = K exp(-rT) Phi(-d2) - S0 exp(-qT) Phi(-d1)``, with
    ``d1 = [log(S0/K) + (r - q + sigma^2 / 2) T] / (sigma sqrt(T))`` and
    ``d2 = d1 - sigma sqrt(T)``.

    Parameters
    ----------
    S0 : float or ndarray
        Spot price, strictly positive.
    K : float or ndarray
        Strike, strictly positive.
    T : float or ndarray
        Maturity in years, non-negative.
    r : float or ndarray
        Continuously compounded risk-free rate, decimal (0.0375 for 3.75 %).
    sigma : float or ndarray
        Annualised volatility, decimal (0.17 for 17 %), non-negative.
    q : float or ndarray, optional
        Continuous dividend yield, decimal (default 0.0).
    kind : {'call', 'put'}, optional
        Option type (default ``'call'``).

    Returns
    -------
    float or ndarray
        The price ``V_0``, a *number* (never a random variable).  All arguments
        broadcast against each other; the result is a float when every argument
        is a scalar, an array otherwise.

    Notes
    -----
    The degenerate cases ``T = 0`` and ``sigma = 0`` return the discounted
    intrinsic value ``exp(-rT) (F - K)^+`` (call), with ``F = S0 exp((r - q) T)``.

    Examples
    --------
    >>> round(black_scholes(100.0, 100.0, 1.0, 0.05, 0.20), 4)
    10.4506
    >>> round(black_scholes(100.0, 100.0, 1.0, 0.05, 0.20, kind="put"), 4)
    5.5735
    """
    kind = _check_kind(kind)
    S0_, K_, T_, r_, sigma_, q_ = _as_float_arrays(S0, K, T, r, sigma, q)
    d1, d2, _ = _bs_d1_d2(S0_, K_, T_, r_, sigma_, q_)
    df_q = np.exp(-q_ * T_)
    df_r = np.exp(-r_ * T_)
    if kind == "call":
        price = S0_ * df_q * norm.cdf(d1) - K_ * df_r * norm.cdf(d2)
    else:
        price = K_ * df_r * norm.cdf(-d2) - S0_ * df_q * norm.cdf(-d1)
    return _unwrap(price)


def black_scholes_greeks(
    S0: float | np.ndarray,
    K: float | np.ndarray,
    T: float | np.ndarray,
    r: float | np.ndarray,
    sigma: float | np.ndarray,
    q: float | np.ndarray = 0.0,
    kind: str = "call",
) -> dict[str, float | np.ndarray]:
    """Closed-form Black-Scholes Greeks of a European option.

    Parameters
    ----------
    S0, K, T, r, sigma, q, kind
        Same meaning, units and broadcasting rules as in :func:`black_scholes`.

    Returns
    -------
    dict
        Keys ``'delta'``, ``'gamma'``, ``'vega'``, ``'theta'``, ``'rho'``; each
        value is a float (scalar inputs) or an ndarray.

    Notes
    -----
    Units, to be stated in every table of results:

    * ``delta = dV/dS0`` (dimensionless), ``gamma = d2V/dS0^2`` (per unit of spot);
    * ``vega = dV/dsigma`` **per unit of volatility** (multiply by 0.01 for the
      "per volatility point" convention);
    * ``theta = dV/dt`` **per year** (divide by 252 or 365 for a daily theta),
      negative for a long option in most cases;
    * ``rho = dV/dr`` **per unit of rate** (multiply by 0.01 for a 1 bp x 100 move).

    When ``sigma sqrt(T) = 0`` the second-order sensitivities are not defined at
    the money; ``gamma`` and ``vega`` are then returned as 0 and ``theta`` loses
    its diffusion term.

    Examples
    --------
    >>> g = black_scholes_greeks(100.0, 100.0, 1.0, 0.05, 0.20)
    >>> round(g["delta"], 4), round(g["vega"], 4)
    (0.6368, 37.524)
    """
    kind = _check_kind(kind)
    S0_, K_, T_, r_, sigma_, q_ = _as_float_arrays(S0, K, T, r, sigma, q)
    d1, d2, vol = _bs_d1_d2(S0_, K_, T_, r_, sigma_, q_)
    df_q = np.exp(-q_ * T_)
    df_r = np.exp(-r_ * T_)
    pdf_d1 = norm.pdf(d1)  # 0 when d1 = +/- inf, which is what we want
    sqrt_T = np.sqrt(T_)
    positive = vol > 0.0
    safe_S0_vol = np.where(positive, S0_ * vol, 1.0)
    safe_sqrt_T = np.where(sqrt_T > 0.0, sqrt_T, 1.0)

    gamma = np.where(positive, df_q * pdf_d1 / safe_S0_vol, 0.0)
    vega = np.where(positive, S0_ * df_q * pdf_d1 * sqrt_T, 0.0)
    # Diffusion part of theta, common to calls and puts.
    theta_diffusion = np.where(
        positive, -S0_ * df_q * pdf_d1 * sigma_ / (2.0 * safe_sqrt_T), 0.0
    )

    if kind == "call":
        delta = df_q * norm.cdf(d1)
        theta = theta_diffusion + q_ * S0_ * df_q * norm.cdf(d1) - r_ * K_ * df_r * norm.cdf(d2)
        rho = K_ * T_ * df_r * norm.cdf(d2)
    else:
        delta = -df_q * norm.cdf(-d1)
        theta = theta_diffusion - q_ * S0_ * df_q * norm.cdf(-d1) + r_ * K_ * df_r * norm.cdf(-d2)
        rho = -K_ * T_ * df_r * norm.cdf(-d2)

    return {
        "delta": _unwrap(delta),
        "gamma": _unwrap(gamma),
        "vega": _unwrap(vega),
        "theta": _unwrap(theta),
        "rho": _unwrap(rho),
    }


# ---------------------------------------------------------------------------
# 3. Simulation of Brownian motion and geometric Brownian motion
# ---------------------------------------------------------------------------


def _check_rng(rng: np.random.Generator) -> np.random.Generator:
    if not isinstance(rng, np.random.Generator):
        raise TypeError(
            "rng must be a numpy.random.Generator, e.g. np.random.default_rng(42); "
            "np.random.seed() and the legacy np.random.* functions are banned in this course"
        )
    return rng


def _check_size(n_elements: int, what: str) -> None:
    if n_elements > MAX_ARRAY_ELEMENTS:
        raise ValueError(
            f"{what} would allocate {n_elements:,} float64 elements "
            f"(> MAX_ARRAY_ELEMENTS = {MAX_ARRAY_ELEMENTS:,}, about "
            f"{8 * n_elements / 1e6:.0f} MB). Loop over blocks instead "
            "(see price_european_mc and NOTATION.md section 12)."
        )


def simulate_brownian(
    T: float,
    n_steps: int,
    n_paths: int,
    rng: np.random.Generator,
    d: int = 1,
) -> np.ndarray:
    """Simulate ``d`` independent standard Brownian motions on a regular grid.

    ``W_{t_{k+1}} = W_{t_k} + sqrt(dt) Z_{k+1}`` with ``dt = T / n_steps`` and
    ``Z ~ N(0, 1)`` i.i.d.; the simulation is exact (the Brownian increments are
    exactly Gaussian), there is no discretisation bias.

    Parameters
    ----------
    T : float
        Horizon in years, strictly positive.
    n_steps : int
        Number of time steps ``M``; the grid is ``t_k = k T / M``, ``k = 0..M``.
    n_paths : int
        Number of paths ``N``.
    rng : numpy.random.Generator
        Source of randomness, e.g. ``np.random.default_rng(42)``.
    d : int, optional
        Number of independent components (default 1).

    Returns
    -------
    ndarray
        Shape ``(n_paths, n_steps + 1)`` when ``d == 1``, and
        ``(n_paths, n_steps + 1, d)`` when ``d > 1``.  Column 0 is ``W_0 = 0``.

    Notes
    -----
    Correlated Brownian motions are obtained by post-multiplying the ``d``
    independent components by the Cholesky factor ``L`` of the correlation
    matrix (session 2): ``W_corr = W @ L.T``.
    """
    rng = _check_rng(rng)
    if T <= 0:
        raise ValueError("T must be strictly positive")
    if n_steps < 1 or n_paths < 1 or d < 1:
        raise ValueError("n_steps, n_paths and d must be >= 1")
    _check_size(n_paths * (n_steps + 1) * d, "simulate_brownian")

    dt = T / n_steps
    shape = (n_paths, n_steps) if d == 1 else (n_paths, n_steps, d)
    increments = np.sqrt(dt) * rng.standard_normal(shape)
    out = np.zeros((n_paths, n_steps + 1) if d == 1 else (n_paths, n_steps + 1, d))
    np.cumsum(increments, axis=1, out=out[:, 1:])
    return out


def simulate_gbm_terminal(
    S0: float,
    drift: float,
    sigma: float,
    T: float,
    n_paths: int,
    rng: np.random.Generator,
    antithetic: bool = False,
) -> np.ndarray:
    """Exact simulation of the terminal value ``S_T`` of a geometric Brownian motion.

    ``S_T = S0 exp((drift - sigma^2 / 2) T + sigma sqrt(T) Z)``, ``Z ~ N(0, 1)``.
    The scheme is *exact*: the law of the simulated ``S_T`` is the exact
    lognormal law, whatever the number of steps.  There is no discretisation
    bias here, only statistical error.

    Parameters
    ----------
    S0 : float
        Initial value, strictly positive.
    drift : float
        Drift of the log-price *before* the Ito correction, in the sense
        ``dS_t / S_t = drift dt + sigma dW_t``:
        **``r - q`` under the risk-neutral measure Q, ``mu`` under the
        real-world measure P.**  Passing ``mu`` and then discounting at ``r``
        is the single most common mistake of this course; use
        :func:`simulate_gbm_terminal_q` / :func:`simulate_gbm_terminal_p`
        to make the measure explicit in the calling code.
    sigma : float
        Annualised volatility, decimal, non-negative.
    T : float
        Maturity in years, strictly positive.
    n_paths : int
        Number of paths ``N``.  Must be even when ``antithetic=True``.
    rng : numpy.random.Generator
        Source of randomness.
    antithetic : bool, optional
        If True, draw ``N / 2`` normals ``Z`` and use ``(Z, -Z)``: the output is
        the concatenation ``[f(Z), f(-Z)]``, so path ``i`` and path
        ``i + N / 2`` form an antithetic pair (default False).

    Returns
    -------
    ndarray
        Shape ``(n_paths,)``, strictly positive.

    Notes
    -----
    With ``antithetic=True`` the ``N`` outputs are **not** i.i.d.  Averaging the
    two halves first (``0.5 * (Y[:N // 2] + Y[N // 2:])``) gives ``N / 2`` i.i.d.
    draws that can be passed to :func:`mc_estimate`; calling
    :func:`mc_estimate` on the ``N`` raw values understates or overstates the
    standard error.

    Examples
    --------
    >>> rng = np.random.default_rng(42)
    >>> S_T = simulate_gbm_terminal(100.0, 0.05, 0.2, 1.0, 10_000, rng)
    >>> S_T.shape, bool(np.all(S_T > 0))
    ((10000,), True)
    """
    rng = _check_rng(rng)
    if S0 <= 0:
        raise ValueError("S0 must be strictly positive")
    if sigma < 0:
        raise ValueError("sigma must be non-negative")
    if T <= 0:
        raise ValueError("T must be strictly positive")
    if n_paths < 1:
        raise ValueError("n_paths must be >= 1")
    _check_size(n_paths, "simulate_gbm_terminal")

    if antithetic:
        if n_paths % 2 != 0:
            raise ValueError("n_paths must be even when antithetic=True")
        half = rng.standard_normal(n_paths // 2)
        z = np.concatenate([half, -half])
    else:
        z = rng.standard_normal(n_paths)

    return S0 * np.exp((drift - 0.5 * sigma**2) * T + sigma * np.sqrt(T) * z)


def simulate_gbm_terminal_q(
    S0: float,
    r: float,
    sigma: float,
    T: float,
    n_paths: int,
    rng: np.random.Generator,
    q: float = 0.0,
    antithetic: bool = False,
) -> np.ndarray:
    """Terminal value ``S_T`` simulated **under the risk-neutral measure Q** (drift ``r - q``).

    Thin wrapper around :func:`simulate_gbm_terminal` whose only purpose is to
    make the measure visible at the call site.  Use it for *pricing*: the
    discounted asset ``exp(-rt) S_t exp(qt)`` is then a Q-martingale, which
    :func:`martingale_check` verifies.

    Parameters
    ----------
    S0, sigma, T, n_paths, rng, antithetic
        See :func:`simulate_gbm_terminal`.
    r : float
        Continuously compounded risk-free rate, decimal.
    q : float, optional
        Continuous dividend yield, decimal (default 0.0).

    Returns
    -------
    ndarray
        Shape ``(n_paths,)``.
    """
    return simulate_gbm_terminal(S0, r - q, sigma, T, n_paths, rng, antithetic=antithetic)


def simulate_gbm_terminal_p(
    S0: float,
    mu: float,
    sigma: float,
    T: float,
    n_paths: int,
    rng: np.random.Generator,
    antithetic: bool = False,
) -> np.ndarray:
    """Terminal value ``S_T`` simulated **under the real-world measure P** (drift ``mu``).

    Use it for *risk* (VaR, expected shortfall, wealth dynamics of a dynamic
    programming problem), never for pricing: discounting a P-simulation at the
    risk-free rate is the classic P/Q confusion of session 2.

    Parameters
    ----------
    S0, sigma, T, n_paths, rng, antithetic
        See :func:`simulate_gbm_terminal`.
    mu : float
        Expected (arithmetic) return under P, annualised decimal.

    Returns
    -------
    ndarray
        Shape ``(n_paths,)``.
    """
    return simulate_gbm_terminal(S0, mu, sigma, T, n_paths, rng, antithetic=antithetic)


def simulate_gbm_paths(
    S0: float,
    drift: float,
    sigma: float,
    T: float,
    n_steps: int,
    n_paths: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Exact simulation of full geometric Brownian motion paths on a regular grid.

    ``S_{t_{k+1}} = S_{t_k} exp((drift - sigma^2 / 2) dt + sigma sqrt(dt) Z_{k+1})``
    with ``dt = T / n_steps``.  The scheme is exact at every grid date (the
    exponential of the exact Gaussian increment), so the only bias left is the
    one coming from the *payoff* being monitored discretely (Asian, barrier),
    not from the diffusion itself.

    Parameters
    ----------
    S0 : float
        Initial value, strictly positive.
    drift : float
        ``r - q`` under the risk-neutral measure Q, ``mu`` under the real-world
        measure P (see :func:`simulate_gbm_terminal`).
    sigma : float
        Annualised volatility, decimal, non-negative.
    T : float
        Horizon in years, strictly positive.
    n_steps : int
        Number of time steps ``M``.
    n_paths : int
        Number of paths ``N``.
    rng : numpy.random.Generator
        Source of randomness.

    Returns
    -------
    ndarray
        Shape ``(n_paths, n_steps + 1)``; ``out[:, 0] == S0`` exactly and
        ``out[:, k]`` is ``S_{t_k}`` with ``t_k = k T / n_steps``.

    Examples
    --------
    >>> rng = np.random.default_rng(0)
    >>> paths = simulate_gbm_paths(100.0, 0.03, 0.2, 1.0, 12, 5, rng)
    >>> paths.shape, bool(np.all(paths[:, 0] == 100.0))
    ((5, 13), True)
    """
    rng = _check_rng(rng)
    if S0 <= 0:
        raise ValueError("S0 must be strictly positive")
    if sigma < 0:
        raise ValueError("sigma must be non-negative")
    if T <= 0:
        raise ValueError("T must be strictly positive")
    if n_steps < 1 or n_paths < 1:
        raise ValueError("n_steps and n_paths must be >= 1")
    _check_size(n_paths * (n_steps + 1), "simulate_gbm_paths")

    dt = T / n_steps
    z = rng.standard_normal((n_paths, n_steps))
    log_increments = (drift - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * z
    out = np.empty((n_paths, n_steps + 1), dtype=float)
    out[:, 0] = S0
    np.cumsum(log_increments, axis=1, out=out[:, 1:])
    np.exp(out[:, 1:], out=out[:, 1:])
    out[:, 1:] *= S0
    return out


# ---------------------------------------------------------------------------
# 4. Sanity checks and pricers
# ---------------------------------------------------------------------------


def _martingale_z(mean_disc: float, se_disc: float, S0: float, r: float, T: float, q: float) -> float:
    """z-score of ``E[exp(-rT) S_T]`` against its theoretical value ``S0 exp(-qT)``."""
    target = S0 * np.exp(-q * T)
    if se_disc <= 0.0:
        return 0.0 if np.isclose(mean_disc, target) else np.inf
    return float((mean_disc - target) / se_disc)


def martingale_check(
    S_T: np.ndarray,
    S0: float,
    r: float,
    T: float,
    q: float = 0.0,
    tol_se: float = 3.0,
) -> tuple[bool, float]:
    """Check that the discounted asset is a martingale under Q, within Monte Carlo noise.

    Under Q the discounted asset with reinvested dividends is a martingale, so
    ``E^Q[exp(-rT) S_T] = S0 exp(-qT)``.  The test compares the empirical mean of
    ``exp(-rT) S_T`` to that target in units of its own standard error.  It is
    the only cheap test that catches "simulated under P, discounted at r"
    (typical error 5 of the course), and it costs nothing since ``S_T`` is
    already simulated.

    Parameters
    ----------
    S_T : ndarray
        Simulated terminal values, shape ``(n_paths,)``; must be i.i.d. draws
        (do **not** pass antithetic output without pairing it first).
    S0 : float
        Initial value used for the simulation.
    r : float
        Risk-free rate used for discounting, decimal.
    T : float
        Maturity in years.
    q : float, optional
        Continuous dividend yield, decimal (default 0.0).
    tol_se : float, optional
        Tolerance in standard errors (default 3.0, i.e. a two-sided test at
        about 0.3 %).

    Returns
    -------
    ok : bool
        True if ``abs(z) <= tol_se``.
    z : float
        ``(mean(exp(-rT) S_T) - S0 exp(-qT)) / SE``.

    Notes
    -----
    The test has power against a wrong drift, a wrong discount factor and a
    forgotten dividend yield; it has *no* power against a wrong payoff or a
    wrong strike.  It is a necessary condition, not a proof of correctness.

    Examples
    --------
    >>> rng = np.random.default_rng(1)
    >>> S_T = simulate_gbm_terminal_q(100.0, 0.05, 0.2, 1.0, 200_000, rng)
    >>> ok, z = martingale_check(S_T, 100.0, 0.05, 1.0)
    >>> ok
    True
    """
    S_T = np.asarray(S_T, dtype=float).ravel()
    n = S_T.size
    if n < 2:
        raise ValueError("martingale_check needs at least 2 paths")
    disc = np.exp(-r * T) * S_T
    mean_disc = float(disc.mean())
    se_disc = float(disc.std(ddof=1) / np.sqrt(n))
    z = _martingale_z(mean_disc, se_disc, S0, r, T, q)
    return bool(abs(z) <= tol_se), z


def price_european_mc(
    S0: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    rng: np.random.Generator,
    n_paths: int,
    kind: str = "call",
    q: float = 0.0,
    block_size: int = 1_000_000,
) -> MCResult:
    """Monte Carlo price of a European call or put under the Black-Scholes model.

    Simulates ``S_T`` **under Q** (drift ``r - q``) with the exact lognormal
    scheme, averages the discounted payoff ``exp(-rT) (S_T - K)^+`` (call) or
    ``exp(-rT) (K - S_T)^+`` (put), and returns the estimate with its standard
    error and confidence interval.

    Memory is bounded by the block convention of ``NOTATION.md`` section 12: the
    ``n_paths`` draws are produced in blocks of at most ``block_size`` and only
    the running sums and sums of squares are kept, so the peak allocation is
    ``O(block_size)`` and never ``O(n_paths)``.

    Parameters
    ----------
    S0, K, T, r, sigma, q
        Model and contract parameters, same units as :func:`black_scholes`.
    rng : numpy.random.Generator
        Source of randomness; the blocks consume it sequentially.
    n_paths : int
        Total number of i.i.d. paths ``N``.
    kind : {'call', 'put'}, optional
        Option type (default ``'call'``).
    block_size : int, optional
        Maximum number of paths simulated at once (default 1 000 000, i.e.
        about 8 MB per temporary array).

    Returns
    -------
    MCResult
        ``mean`` is ``\\hat{V}_N``, ``se`` its standard error, the interval is
        the 95 % normal interval, ``seconds`` times the simulation only.

    Raises
    ------
    AssertionError
        If the martingale check on ``exp(-rT) S_T`` fails at 3 standard errors,
        which means the simulation is not under Q (wrong drift, wrong ``q``).

    Notes
    -----
    Reproducibility across ``block_size``: because a ``Generator`` is a
    sequential stream, ``rng.standard_normal(a)`` then ``rng.standard_normal(b)``
    produces exactly the same numbers as ``rng.standard_normal(a + b)``.  From a
    given seed, two runs with different ``block_size`` therefore use the *same*
    normals and agree up to floating-point summation order only (relative
    difference of order 1e-15, since the partial sums are added in a different
    order).  They are *not* required to be bit-for-bit identical.

    Examples
    --------
    >>> rng = np.random.default_rng(42)
    >>> res = price_european_mc(100.0, 100.0, 1.0, 0.05, 0.2, rng, 200_000)
    >>> abs(res.mean - black_scholes(100.0, 100.0, 1.0, 0.05, 0.2)) < 3 * res.se
    True
    """
    kind = _check_kind(kind)
    rng = _check_rng(rng)
    if n_paths < 2:
        raise ValueError("n_paths must be >= 2 (a standard error needs at least 2 samples)")
    if block_size < 1:
        raise ValueError("block_size must be >= 1")
    if K <= 0:
        raise ValueError("K must be strictly positive")

    disc = np.exp(-r * T)
    sum_y = 0.0  # sum of discounted payoffs
    sum_y2 = 0.0  # sum of squared discounted payoffs
    sum_s = 0.0  # sum of discounted terminal values (martingale check)
    sum_s2 = 0.0
    remaining = int(n_paths)

    with Timer() as tm:
        while remaining > 0:
            m = min(block_size, remaining)
            S_T = simulate_gbm_terminal_q(S0, r, sigma, T, m, rng, q=q)
            payoff = np.maximum(S_T - K, 0.0) if kind == "call" else np.maximum(K - S_T, 0.0)
            y = disc * payoff
            s = disc * S_T
            sum_y += float(y.sum())
            sum_y2 += float(np.dot(y, y))
            sum_s += float(s.sum())
            sum_s2 += float(np.dot(s, s))
            remaining -= m
    seconds = tm.seconds

    n = int(n_paths)
    mean_y = sum_y / n
    var_y = max((sum_y2 - n * mean_y**2) / (n - 1), 0.0)
    se_y = np.sqrt(var_y / n)

    mean_s = sum_s / n
    var_s = max((sum_s2 - n * mean_s**2) / (n - 1), 0.0)
    se_s = np.sqrt(var_s / n)
    z_mart = _martingale_z(mean_s, se_s, S0, r, T, q)
    assert abs(z_mart) <= 3.0, (
        "martingale check failed: mean(exp(-rT) S_T) is "
        f"{z_mart:.2f} standard errors away from S0 exp(-qT) "
        f"({mean_s:.6f} vs {S0 * np.exp(-q * T):.6f}). "
        "The paths are probably not simulated under Q."
    )

    zq = norm.ppf(0.975)  # 95 % two-sided
    return MCResult(
        float(mean_y),
        float(se_y),
        float(mean_y - zq * se_y),
        float(mean_y + zq * se_y),
        n,
        float(seconds),
    )


# ---------------------------------------------------------------------------
# 4b. Binomial tree, closed forms and path-dependent pricers (added for S3-S7)
# ---------------------------------------------------------------------------


def crr_option(
    S0: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    n_steps: int,
    kind: str = "call",
    american: bool = False,
    q: float = 0.0,
) -> float:
    """Cox-Ross-Rubinstein binomial price of a European or American vanilla option.

    Lattice of ``NOTATION.md`` section 13: with ``dt = T / n_steps``,

    ``u = exp(sigma sqrt(dt))``, ``d = 1 / u``,
    ``p_u = (exp((r - q) dt) - d) / (u - d)``,

    and the backward recursion, applied **column by column** (one vectorised
    numpy slice per time step, never a loop over nodes),

    ``V_k = max( h(S_k), exp(-r dt) [ p_u V_{k+1}^up + (1 - p_u) V_{k+1}^down ] )``

    the ``max`` being taken only when ``american`` is true (otherwise the
    continuation value is kept as is).  Node values are rebuilt at each step
    from ``S_k(j) = S0 u^(2j - k)``, which is exact and avoids accumulating
    rounding along the recursion.

    This is an **instrument of control**, not an object of study: it gives the
    reference against which the LSM price of session 7 and the protective put
    of session 6 are checked.  It returns a plain ``float`` and not an
    :class:`MCResult`, because there is no randomness in it.

    Parameters
    ----------
    S0, K : float
        Spot and strike, strictly positive.
    T : float
        Maturity in years, strictly positive.
    r, q : float
        Risk-free rate and continuous dividend yield, decimals.
    sigma : float
        Annualised volatility, decimal, strictly positive.
    n_steps : int
        Number of steps ``M`` of the tree (``>= 1``).  2 000 steps are enough
        for four exact decimals on the Longstaff-Schwartz triplets.
    kind : {'call', 'put'}, optional
        Option type (default ``'call'``).
    american : bool, optional
        If true, allow exercise at every node (default false = European).

    Returns
    -------
    float
        The option price at ``t = 0``.

    Raises
    ------
    ValueError
        If the no-arbitrage condition ``d < exp((r - q) dt) < u`` of the lattice
        is violated, which happens when ``dt`` is too large for ``sigma``
        (the condition reads ``dt < sigma**2 / (r - q)**2``); take more steps.

    Notes
    -----
    Non-regression values used by the tests, ``K = 40``, ``r = 6 %``,
    2 000 steps, American put: ``(36; 0.20; 1) -> 4.4867``,
    ``(40; 0.20; 1) -> 2.3194``, ``(44; 0.40; 2) -> 5.6472``.  At 1 000 steps
    the first one gives 4.4868, i.e. within 0.009 of the finite-difference
    price 4.478 published in Table 1 of Longstaff and Schwartz (2001).

    Examples
    --------
    >>> abs(crr_option(100.0, 100.0, 1.0, 0.05, 0.2, 2000) - 10.4506) < 0.01
    True
    >>> european = crr_option(36.0, 40.0, 1.0, 0.06, 0.2, 2000, kind="put")
    >>> american = crr_option(36.0, 40.0, 1.0, 0.06, 0.2, 2000, kind="put",
    ...                       american=True)
    >>> american > european
    True
    """
    kind = _check_kind(kind)
    if S0 <= 0 or K <= 0:
        raise ValueError("S0 and K must be strictly positive")
    if T <= 0:
        raise ValueError("T must be strictly positive")
    if sigma <= 0:
        raise ValueError("sigma must be strictly positive (a tree needs u > d)")
    n_steps = int(n_steps)
    if n_steps < 1:
        raise ValueError("n_steps must be >= 1")
    _check_size(n_steps + 1, "crr_option")

    dt = T / n_steps
    u = np.exp(sigma * np.sqrt(dt))
    d = 1.0 / u
    growth = np.exp((r - q) * dt)
    if not (d < growth < u):
        raise ValueError(
            f"CRR lattice is arbitrageable at dt = {dt:.6g}: the condition "
            f"d < exp((r - q) dt) < u reads {d:.6f} < {growth:.6f} < {u:.6f}. "
            "Increase n_steps (the condition is dt < sigma**2 / (r - q)**2)."
        )
    p_u = (growth - d) / (u - d)
    disc = np.exp(-r * dt)
    sign = 1.0 if kind == "call" else -1.0
    log_u = sigma * np.sqrt(dt)

    j = np.arange(n_steps + 1, dtype=float)
    S = S0 * np.exp(log_u * (2.0 * j - n_steps))
    values = np.maximum(sign * (S - K), 0.0)

    for k in range(n_steps - 1, -1, -1):
        values = disc * (p_u * values[1 : k + 2] + (1.0 - p_u) * values[0 : k + 1])
        if american:
            j = np.arange(k + 1, dtype=float)
            S = S0 * np.exp(log_u * (2.0 * j - k))
            np.maximum(values, sign * (S - K), out=values)
    return float(values[0])


def crr_american_put(
    S0: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    n_steps: int,
    q: float = 0.0,
) -> float:
    """American put on a CRR binomial tree (``NOTATION.md`` section 9.1).

    Thin, explicitly named wrapper around
    ``crr_option(..., kind="put", american=True)``; see that function for the
    lattice, the vectorisation and the raises.  Returns a ``float`` (a price,
    not an :class:`MCResult`: there is no randomness here).

    Parameters
    ----------
    S0, K, T, r, sigma, q
        As in :func:`crr_option`.
    n_steps : int
        Number of steps ``M`` of the tree.

    Returns
    -------
    float

    Examples
    --------
    >>> abs(crr_american_put(36.0, 40.0, 1.0, 0.06, 0.20, 2000) - 4.4867) < 5e-4
    True
    >>> abs(crr_american_put(40.0, 40.0, 1.0, 0.06, 0.20, 2000) - 2.3194) < 5e-4
    True
    """
    return crr_option(S0, K, T, r, sigma, n_steps, kind="put", american=True, q=q)


def _geometric_average_moments(
    S0: float, T: float, r: float, sigma: float, n_dates: int, q: float
) -> tuple[float, float]:
    """Mean and variance of ``log G`` for a discrete geometric average (helper).

    ``G = (prod_{k=1..n} S_{t_k})^(1/n)`` on the equidistant dates
    ``t_k = k T / n``.  Under Q, ``log S_{t_k} = log S0 + (r - q - sigma^2/2) t_k
    + sigma W_{t_k}``, hence ``log G`` Gaussian with

    ``m = log S0 + (r - q - sigma^2 / 2) * T (n + 1) / (2 n)``
    ``s^2 = sigma^2 T (n + 1)(2 n + 1) / (6 n^2)``

    using ``sum_k t_k = T (n + 1) / 2`` and
    ``sum_{j,k} min(t_j, t_k) = (T / n) n (n + 1)(2 n + 1) / 6``.
    """
    n = float(n_dates)
    m = np.log(S0) + (r - q - 0.5 * sigma**2) * T * (n + 1.0) / (2.0 * n)
    s2 = sigma**2 * T * (n + 1.0) * (2.0 * n + 1.0) / (6.0 * n * n)
    return float(m), float(s2)


def asian_geometric_closed_form(
    S0: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    n_dates: int,
    q: float = 0.0,
    kind: str = "call",
) -> float:
    """Closed-form price of a **discrete** geometric-average Asian option (Kemna-Vorst).

    The average is taken over the ``n_dates`` equidistant monitoring dates
    ``t_k = k T / n_dates``, ``k = 1, ..., n_dates`` (the last one is ``T``;
    ``S0`` itself is *not* in the average -- this is the convention of the whole
    course, ``NOTATION.md`` section 9.1).

    Under Q the geometric average

    ``G = (prod_{k=1}^{n} S_{t_k})^(1/n)``

    is exactly lognormal, ``log G ~ N(m, s^2)`` with

    ``m   = log S0 + (r - q - sigma^2 / 2) * T (n + 1) / (2 n)``
    ``s^2 = sigma^2 * T * (n + 1) (2 n + 1) / (6 n^2)``

    (the first from ``sum_k t_k = T (n + 1) / 2``, the second from
    ``Var(sum_k W_{t_k}) = sum_{j,k} min(t_j, t_k)
    = (T / n) * n (n + 1)(2 n + 1) / 6``), hence the Black-Scholes-like formula

    ``call = exp(-rT) [ exp(m + s^2 / 2) Phi(d1) - K Phi(d2) ]``
    ``put  = exp(-rT) [ K Phi(-d2) - exp(m + s^2 / 2) Phi(-d1) ]``
    ``d1 = (m - log K + s^2) / s``, ``d2 = d1 - s``.

    Letting ``n -> infinity`` gives back the continuous Kemna-Vorst (1990)
    formula; the *discrete* version above is the one to use as a control
    variate for a discretely monitored arithmetic Asian, because it is the
    exact expectation of the control that is actually simulated.

    Parameters
    ----------
    S0, K : float
        Spot and strike, strictly positive.
    T : float
        Maturity in years, strictly positive.
    r, q : float
        Risk-free rate and continuous dividend yield, decimals.
    sigma : float
        Annualised volatility, decimal, non-negative.
    n_dates : int
        Number ``n_A`` of monitoring dates (``>= 1``).  ``n_dates = 1`` gives
        back the plain European Black-Scholes price.
    kind : {'call', 'put'}, optional

    Returns
    -------
    float

    Notes
    -----
    Red-thread non-regression (``S0 = K = 7718.60``, ``r = 3.75 %``, ``T = 1``,
    12 dates): 313.6347 at ``sigma_1y = 12.84 %`` and 383.0313 at
    ``sigma_5y = 16.96 %``.

    Examples
    --------
    >>> abs(asian_geometric_closed_form(7718.60, 7718.60, 1.0, 0.0375, 0.1284, 12)
    ...     - 313.6347) < 1e-3
    True
    >>> abs(asian_geometric_closed_form(100.0, 100.0, 1.0, 0.05, 0.2, 1)
    ...     - black_scholes(100.0, 100.0, 1.0, 0.05, 0.2)) < 1e-10
    True
    """
    kind = _check_kind(kind)
    if S0 <= 0 or K <= 0:
        raise ValueError("S0 and K must be strictly positive")
    if T <= 0:
        raise ValueError("T must be strictly positive")
    if sigma < 0:
        raise ValueError("sigma must be non-negative")
    n_dates = int(n_dates)
    if n_dates < 1:
        raise ValueError("n_dates must be >= 1")

    m, s2 = _geometric_average_moments(S0, T, r, sigma, n_dates, q)
    s = np.sqrt(s2)
    forward = np.exp(m + 0.5 * s2)
    disc = np.exp(-r * T)
    if s <= 0.0:  # sigma = 0: the average is deterministic
        payoff = max(forward - K, 0.0) if kind == "call" else max(K - forward, 0.0)
        return float(disc * payoff)
    d1 = (m - np.log(K) + s2) / s
    d2 = d1 - s
    if kind == "call":
        return float(disc * (forward * norm.cdf(d1) - K * norm.cdf(d2)))
    return float(disc * (K * norm.cdf(-d2) - forward * norm.cdf(-d1)))


def price_asian_mc(
    S0: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    n_dates: int,
    n_paths: int,
    rng: np.random.Generator,
    q: float = 0.0,
    kind: str = "call",
    average: str = "arithmetic",
    control_variate: bool = False,
    block_size: int | None = None,
    b: float | None = None,
) -> MCResult:
    """Monte Carlo price of a discretely monitored Asian option, with optional control variate.

    The ``n_dates`` monitoring dates are the equidistant ``t_k = k T / n_dates``,
    ``k = 1, ..., n_dates``; ``S0`` is not part of the average.  Paths are exact
    (lognormal increments), so there is no discretisation bias: the only
    remaining "bias" is the contractual discreteness of the average itself.

    Payoffs, with ``A = (1/n) sum_k S_{t_k}`` (arithmetic) or
    ``G = exp((1/n) sum_k log S_{t_k})`` (geometric):
    ``exp(-rT) (A - K)^+`` for a call, ``exp(-rT) (K - A)^+`` for a put.

    **Control variate** (``control_variate=True``, arithmetic average only).
    The control is the discrete *geometric* Asian of the same contract, whose
    expectation :func:`asian_geometric_closed_form` gives in closed form:

    ``Y^b = Y - b (C - E[C])``, ``b* = Cov(Y, C) / Var(C)``.

    Following ``NOTATION.md`` section 6, ``b*`` is estimated on a **separate
    pilot sample** (10 % of ``n_paths``, drawn first from ``rng`` and *not*
    reused), so that ``b`` and the ``n_paths`` samples are independent and the
    estimator stays unbiased.  Pass ``b`` explicitly to skip the pilot.

    **Memory** follows the block convention of ``NOTATION.md`` section 12: paths
    are produced in blocks of ``block_size`` and only running sums and sums of
    squares are kept, so the peak allocation is ``O(block_size * n_dates)`` and
    never ``O(n_paths * n_dates)``.

    Parameters
    ----------
    S0, K, T, r, sigma, q
        Model and contract parameters, same units as :func:`black_scholes`.
    n_dates : int
        Number ``n_A`` of monitoring dates.
    n_paths : int
        Number ``N`` of i.i.d. paths used by the estimator (the pilot paths of
        the control variate are drawn *in addition* to these).
    rng : numpy.random.Generator
        Source of randomness; blocks consume it sequentially.
    kind : {'call', 'put'}, optional
    average : {'arithmetic', 'geometric'}, optional
        Which average the payoff is written on (default arithmetic).  The
        geometric one has a closed form and is there to *validate* the
        simulator, see :func:`asian_geometric_closed_form`.
    control_variate : bool, optional
        Use the geometric Asian as a control (arithmetic average only).
    block_size : int or None, optional
        Paths per block; default ``MAX_ARRAY_ELEMENTS // (4 * n_dates)``
        (about 208 000 paths for 12 dates), capped at ``n_paths``.
    b : float or None, optional
        Fixed control coefficient; ``None`` (default) estimates ``b*`` on the
        pilot sample.

    Returns
    -------
    MCResult
        ``n`` is ``n_paths`` (pilot paths excluded), ``seconds`` times the
        simulation only.

    Raises
    ------
    AssertionError
        If the martingale check on ``exp(-rT) S_T`` fails at 3 standard errors.
    ValueError
        If ``control_variate`` is asked for a geometric average (the control
        would then be the payoff itself).

    Notes
    -----
    Red-thread non-regression (``S0 = K = 7718.60``, ``r = 3.75 %``,
    ``sigma_1y = 12.84 %``, ``T = 1``, 12 dates): arithmetic call
    **320.801 +/- 0.001** (8 x 10^7 paths with the geometric control),
    geometric call 313.6347 (closed form).

    Examples
    --------
    >>> rng = np.random.default_rng(42)
    >>> res = price_asian_mc(7718.60, 7718.60, 1.0, 0.0375, 0.1284, 12, 200_000,
    ...                      rng, control_variate=True)
    >>> abs(res.mean - 320.801) < 4 * res.se
    True
    """
    kind = _check_kind(kind)
    rng = _check_rng(rng)
    average = str(average).lower()
    if average not in ("arithmetic", "geometric"):
        raise ValueError(f"average must be 'arithmetic' or 'geometric', got {average!r}")
    if S0 <= 0 or K <= 0:
        raise ValueError("S0 and K must be strictly positive")
    if T <= 0:
        raise ValueError("T must be strictly positive")
    if sigma < 0:
        raise ValueError("sigma must be non-negative")
    n_dates = int(n_dates)
    if n_dates < 1:
        raise ValueError("n_dates must be >= 1")
    n_paths = int(n_paths)
    if n_paths < 2:
        raise ValueError("n_paths must be >= 2 (a standard error needs at least 2 samples)")
    if control_variate and average != "arithmetic":
        raise ValueError(
            "control_variate=True only makes sense for average='arithmetic': "
            "on a geometric average the control *is* the payoff"
        )
    if block_size is None:
        block_size = max(1, MAX_ARRAY_ELEMENTS // (4 * n_dates))
    block_size = int(min(block_size, n_paths))
    if block_size < 1:
        raise ValueError("block_size must be >= 1")
    _check_size(block_size * n_dates, "price_asian_mc")

    dt = T / n_dates
    drift = (r - q - 0.5 * sigma**2) * dt
    vol = sigma * np.sqrt(dt)
    disc = np.exp(-r * T)
    sign = 1.0 if kind == "call" else -1.0
    kv = (
        asian_geometric_closed_form(S0, K, T, r, sigma, n_dates, q=q, kind=kind)
        if control_variate
        else 0.0
    )

    def _draw(m: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Discounted payoff, discounted control payoff and discounted S_T of m paths."""
        z = rng.standard_normal((m, n_dates))
        log_paths = np.cumsum(drift + vol * z, axis=1)
        log_paths += np.log(S0)
        paths = np.exp(log_paths)
        s_t = paths[:, -1].copy()
        log_mean = log_paths.mean(axis=1)
        avg = paths.mean(axis=1) if average == "arithmetic" else np.exp(log_mean)
        y = disc * np.maximum(sign * (avg - K), 0.0)
        if control_variate:
            c = disc * np.maximum(sign * (np.exp(log_mean) - K), 0.0)
        else:
            c = np.zeros(0)
        return y, c, disc * s_t

    with Timer() as tm:
        if control_variate and b is None:
            n_pilot = max(2, min(block_size, n_paths // 10))
            y_p, c_p, _ = _draw(n_pilot)
            var_c = float(c_p.var(ddof=1))
            b = float(np.cov(y_p, c_p, ddof=1)[0, 1] / var_c) if var_c > 0 else 0.0
        b_used = float(b) if (control_variate and b is not None) else 0.0

        sum_y = 0.0
        sum_y2 = 0.0
        sum_s = 0.0
        sum_s2 = 0.0
        remaining = n_paths
        while remaining > 0:
            m = min(block_size, remaining)
            y, c, s = _draw(m)
            if control_variate:
                y = y - b_used * (c - kv)
            sum_y += float(y.sum())
            sum_y2 += float(np.dot(y, y))
            sum_s += float(s.sum())
            sum_s2 += float(np.dot(s, s))
            remaining -= m
    seconds = tm.seconds

    n = n_paths
    mean_y = sum_y / n
    var_y = max((sum_y2 - n * mean_y**2) / (n - 1), 0.0)
    se_y = np.sqrt(var_y / n)

    mean_s = sum_s / n
    var_s = max((sum_s2 - n * mean_s**2) / (n - 1), 0.0)
    se_s = np.sqrt(var_s / n)
    z_mart = _martingale_z(mean_s, se_s, S0, r, T, q)
    assert abs(z_mart) <= 3.0, (
        "martingale check failed: mean(exp(-rT) S_T) is "
        f"{z_mart:.2f} standard errors away from S0 exp(-qT) "
        f"({mean_s:.6f} vs {S0 * np.exp(-q * T):.6f}). "
        "The paths are probably not simulated under Q."
    )

    zq = norm.ppf(0.975)
    return MCResult(
        float(mean_y),
        float(se_y),
        float(mean_y - zq * se_y),
        float(mean_y + zq * se_y),
        n,
        float(seconds),
    )


def brownian_bridge_crossing_prob(
    x_start: float | np.ndarray,
    x_end: float | np.ndarray,
    barrier: float,
    sigma: float,
    dt: float,
    log_space: bool = True,
) -> float | np.ndarray:
    """Probability that a Brownian bridge between two grid dates crosses a barrier.

    Between two monitoring dates the simulated process is a Brownian bridge
    pinned at ``x_start`` and ``x_end``.  Even when both ends are on the safe
    side of the barrier, the bridge may cross in between; ignoring that is the
    whole ``O(1 / sqrt(M))`` bias of a discretely monitored barrier option, and
    multiplying the payoff by ``prod_k (1 - p_k)`` brings it down to
    ``O(1 / M)``.

    **Two forms, and they are not interchangeable** (``NOTATION.md``
    section 9.1):

    * ``log_space=True`` -- **exactly simulated GBM**.  ``log S`` is a Brownian
      motion with constant diffusion coefficient ``sigma``, so the bridge lives
      in log space:

      ``p = exp( -2 log(B / x_start) log(B / x_end) / (sigma^2 dt) )``

      This is the form that produces the unbiased barrier price of session 3
      (126.36 +/- 1.13 at M = 12, for an exact continuous-monitoring value of
      127.0517).  With an exactly simulated process the estimator is unbiased
      for ANY M, including M = 1: the printed value is one draw, not a target.
    * ``log_space=False`` -- **process discretised by Euler**.  The step is
      Gaussian in the *level*, with the diffusion coefficient frozen at
      ``b(t_k, X_k)``:

      ``p = exp( -2 (B - x_start)(B - x_end) / (sigma^2 dt) )``

      where ``sigma`` is then the **absolute** local diffusion coefficient of
      the discretised process, i.e. ``sigma_gbm * x_start`` for an
      Euler-discretised GBM -- which reproduces the arithmetic form
      ``exp(-2 (B - S_k)(B - S_{k+1}) / (sigma^2 S_k^2 dt))`` published in
      ``NOTATION.md`` section 9.1.

    Both formulas are written for a barrier lying on the **same side** of both
    endpoints (an upper barrier above both, or a lower barrier below both);
    when the two endpoints straddle the barrier (or one of them touches it) the
    crossing is certain and the function returns 1.

    Parameters
    ----------
    x_start, x_end : float or ndarray
        Value of the process at the two consecutive grid dates; broadcast
        together.  Strictly positive when ``log_space`` is true.
    barrier : float
        Barrier level ``B``, strictly positive when ``log_space`` is true.
    sigma : float
        Diffusion coefficient over the step: the GBM volatility when
        ``log_space`` is true, the *absolute* coefficient ``b(t_k, X_k)``
        otherwise.  Non-negative.
    dt : float
        Length of the step in years, strictly positive.
    log_space : bool, optional
        Choose the logarithmic (default, exact GBM) or the arithmetic
        (Euler-discretised) form.

    Returns
    -------
    float or ndarray
        Crossing probability in ``[0, 1]``, of the broadcast shape.

    Examples
    --------
    >>> p = brownian_bridge_crossing_prob(100.0, 110.0, 120.0, 0.2, 1 / 12)
    >>> 0.0 < p < 1.0
    True
    >>> brownian_bridge_crossing_prob(100.0, 130.0, 120.0, 0.2, 1 / 12)  # straddled
    1.0
    >>> float(brownian_bridge_crossing_prob(100.0, 100.0, 1e6, 0.2, 1 / 12))
    0.0
    """
    if dt <= 0:
        raise ValueError("dt must be strictly positive")
    if sigma < 0:
        raise ValueError("sigma must be non-negative")
    x_start, x_end = _as_float_arrays(x_start, x_end)
    if log_space:
        if barrier <= 0:
            raise ValueError("barrier must be strictly positive in log space")
        if np.any(x_start <= 0) or np.any(x_end <= 0):
            raise ValueError("x_start and x_end must be strictly positive in log space")
        gap_start = np.log(barrier / x_start)
        gap_end = np.log(barrier / x_end)
    else:
        gap_start = barrier - x_start
        gap_end = barrier - x_end

    var = sigma**2 * dt
    product = gap_start * gap_end
    if var > 0:
        # The exponent is <= 0 whenever the formula applies (product > 0); the
        # clip only avoids an overflow warning on the straddled case, which is
        # overwritten by 1 just below.
        p = np.exp(np.minimum(-2.0 * product / var, 0.0))
    else:  # a deterministic step never crosses strictly between its endpoints
        p = np.zeros_like(product)
    # The bridge is certain to have crossed when the endpoints straddle B (or
    # one of them sits on it): the formula above does not apply there.
    p = np.where(product <= 0.0, 1.0, p)
    p = np.clip(p, 0.0, 1.0)
    return _unwrap(p)


def perpetual_put(
    S: float | np.ndarray, K: float, r: float, sigma: float
) -> float | np.ndarray:
    """Closed-form value of a perpetual American put, no dividend (``NOTATION.md`` section 13).

    Exercise boundary and value:

    ``S* = 2 r K / (2 r + sigma^2)``
    ``P(S) = (K - S*) (S / S*)^(-2 r / sigma^2)``   for ``S >= S*``
    ``P(S) = K - S``                                 for ``S <  S*``

    (negative root ``beta_- = -2 r / sigma^2`` of
    ``sigma^2 beta (beta - 1) / 2 + r beta - r = 0``, plus the smooth-pasting
    condition ``P'(S*) = -1``; the two branches meet with matching value *and*
    slope at ``S*``).

    Why it matters: this is the **only genuinely independent control** of an LSM
    code -- it shares neither the time discretisation nor the regression basis.
    Being of infinite maturity and dividend-free, it is an **upper bound** for
    the finite-maturity American put with the same ``K``, ``r``, ``sigma``.

    Parameters
    ----------
    S : float or ndarray
        Spot value(s), strictly positive.  The case ``S < S*`` is included and
        returns the intrinsic value ``K - S``.
    K : float
        Strike, strictly positive.
    r : float
        Risk-free rate, strictly positive (with ``r = 0`` the perpetual put is
        never exercised and is worth ``K``).
    sigma : float
        Annualised volatility, decimal, strictly positive.

    Returns
    -------
    float or ndarray

    Examples
    --------
    >>> round(perpetual_put(36.0, 40.0, 0.06, 0.20), 6)   # S* = 30
    5.787037
    >>> perpetual_put(20.0, 40.0, 0.06, 0.20)             # below S*: intrinsic
    20.0
    """
    if K <= 0:
        raise ValueError("K must be strictly positive")
    if sigma <= 0:
        raise ValueError("sigma must be strictly positive")
    if r <= 0:
        raise ValueError(
            "r must be strictly positive: with r = 0 the perpetual put is never "
            "exercised and is worth K"
        )
    (S_arr,) = _as_float_arrays(S)
    if np.any(S_arr <= 0):
        raise ValueError("S must be strictly positive")
    s_star = 2.0 * r * K / (2.0 * r + sigma**2)
    exponent = -2.0 * r / sigma**2
    continuation = (K - s_star) * (S_arr / s_star) ** exponent
    out = np.where(S_arr < s_star, K - S_arr, continuation)
    return _unwrap(out)


# ---------------------------------------------------------------------------
# 5. Red-thread data set
# ---------------------------------------------------------------------------

# Red-thread portfolio, daily rebalancing. Source: cours/data/stats_summary.md,
# section "Portefeuille fil rouge" (historical: 11.82 % annualised return,
# 13.40 % annualised volatility, -26.00 % max drawdown, Sharpe 0.60 at r = 3.75 %).
PORTFOLIO_WEIGHTS: dict[str, float] = {
    "SP500": 0.40,
    "CAC40": 0.20,
    "AAPL": 0.10,
    "LVMH": 0.10,
    "GLD": 0.10,
    "TLT": 0.10,
}

# Reference parameters of the course. Source: cours/data/stats_summary.md,
# section 3 "Parametres de reference pour les exercices" (data set v2,
# generated 2026-09-06, panel 2010-01-04 -> 2026-09-04, 4152 trading days).
REFERENCE_PARAMS: dict[str, object] = {
    "underlying": "SP500",  # S&P 500 index level
    "S0": 7718.60,  # close of 2026-09-04
    "sigma_1y": 0.1284,  # annualised vol, last 252 trading days
    "sigma_5y": 0.1696,  # annualised vol, last 1260 trading days
    "sigma_full": 0.1731,  # annualised vol, whole sample
    "r": 0.0375,  # DTB3 of 2026-09-03, converted to decimal
    "spot_date": "2026-09-04",
    "rate_date": "2026-09-03",
    "data_start": "2010-01-04",
    "data_end": "2026-09-04",
    "n_obs": 4152,
    "trading_days": 252,
}


@lru_cache(maxsize=1)
def _data_dir() -> Path:
    """Locate ``cours/data/`` independently of the current working directory.

    The environment variable ``MCDP_DATA_DIR`` overrides the search; otherwise
    the module walks up from its own location (``__file__``) and returns the
    first ``data`` directory that contains ``prices.csv``.
    """
    override = os.environ.get("MCDP_DATA_DIR")
    if override:
        candidate = Path(override).expanduser().resolve()
        if (candidate / "prices.csv").is_file():
            return candidate
        raise FileNotFoundError(
            f"MCDP_DATA_DIR={override!r} does not contain prices.csv"
        )
    here = Path(__file__).resolve().parent
    for base in (here, *here.parents):
        candidate = base / "data"
        if (candidate / "prices.csv").is_file():
            return candidate
    raise FileNotFoundError(
        "could not locate the course data directory (a 'data' folder containing "
        f"prices.csv) upwards from {here}; set MCDP_DATA_DIR to point at it"
    )


@lru_cache(maxsize=8)
def _read_dated_csv(filename: str) -> pd.DataFrame:
    """Read one CSV of ``cours/data/`` with a parsed ``Date`` index (cached)."""
    path = _data_dir() / filename
    if not path.is_file():
        raise FileNotFoundError(f"{path} not found; run cours/data/build_dataset.py")
    return pd.read_csv(path, index_col="Date", parse_dates=True).sort_index()


def load_prices() -> pd.DataFrame:
    """Load ``cours/data/prices.csv``: daily closing prices of the 8 red-thread assets.

    Returns
    -------
    pandas.DataFrame
        Index ``Date`` (``DatetimeIndex``, 4152 trading days from 2010-01-04 to
        2026-09-04), columns ``SP500, SPY, CAC40, AAPL, LVMH, TTE, GLD, TLT`` in
        the currency of their listing place.  The frame is a fresh copy, safe to
        modify.

    Notes
    -----
    The panel is the *intersection* of the trading calendars (no forward fill),
    so every row is a session actually traded on every place.
    """
    return _read_dated_csv("prices.csv").copy()


def load_returns() -> pd.DataFrame:
    """Load ``cours/data/returns_daily.csv``: daily **log** returns of the 8 assets.

    Returns
    -------
    pandas.DataFrame
        Index ``Date``, same columns as :func:`load_prices`, one row fewer
        (the first date has no return).  Unit: decimal fraction
        (``0.0123`` = +1.23 %).

    Notes
    -----
    Log returns ``r_t = log(P_t / P_{t-1})`` are additive in time, which is what
    the geometric Brownian motion of the course uses.  They are *not* additive
    across assets: to weight a portfolio, convert to simple returns first (this
    is what :func:`portfolio_returns` does).
    """
    return _read_dated_csv("returns_daily.csv").copy()


def load_rates() -> pd.DataFrame:
    """Load ``cours/data/rates.csv``: short and long interest rates.

    Returns
    -------
    pandas.DataFrame
        Index ``Date``, columns ``DTB3`` (US 3-month T-bill), ``DGS10`` (US
        10-year), ``ESTR`` (euro short-term rate, available from 2019-10-01
        only, NaN before).

    Notes
    -----
    **Unit: annual percentage as published by FRED** (``4.35`` means 4.35 %).
    Divide by 100 before using a rate in any formula::

        r = load_rates()["DTB3"].dropna().iloc[-1] / 100.0
    """
    return _read_dated_csv("rates.csv").copy()


def load_vix() -> pd.DataFrame:
    """Load ``cours/data/vix.csv``: CBOE VIX closing level.

    Returns
    -------
    pandas.DataFrame
        Index ``Date`` (NYSE calendar, *not* realigned on the price panel),
        single column ``VIX`` in index points, i.e. an annualised implied
        volatility in percent (``18.5`` means 18.5 %).  Divide by 100 to get the
        decimal volatility used by :func:`black_scholes`.
    """
    return _read_dated_csv("vix.csv").copy()


def annualize_stats(returns: pd.DataFrame | pd.Series, periods: int = 252) -> pd.DataFrame:
    """Annualise the mean and the volatility of periodic returns.

    Parameters
    ----------
    returns : DataFrame or Series
        Periodic (typically daily) returns, one column per asset, in decimal.
    periods : int, optional
        Number of periods per year (default 252 trading days).  Using 365 on
        daily *trading* data is the classic annualisation error of the course.

    Returns
    -------
    pandas.DataFrame
        Index = asset names, columns ``['mean', 'vol']`` with
        ``mean = periods * mean(r)`` and ``vol = sqrt(periods) * std(r, ddof=1)``.

    Notes
    -----
    On **log** returns, ``mean`` is the annualised log drift
    ``(mu - sigma^2 / 2)``, not the expected simple return; add ``vol^2 / 2`` to
    obtain the latter.  The square-root-of-time scaling of the volatility
    assumes i.i.d. returns; on real data it understates the risk of the tails
    (excess kurtosis of 3 to 13 in ``stats_summary.md``).
    """
    if isinstance(returns, pd.Series):
        returns = returns.to_frame(name=returns.name or "portfolio")
    if periods <= 0:
        raise ValueError("periods must be strictly positive")
    numeric = returns.select_dtypes(include=[np.number])
    if numeric.shape[1] == 0:
        raise ValueError("returns contains no numeric column")
    return pd.DataFrame(
        {
            "mean": numeric.mean() * periods,
            "vol": numeric.std(ddof=1) * np.sqrt(periods),
        }
    )


def portfolio_returns(
    returns: pd.DataFrame,
    weights: Mapping[str, float] | Sequence[float] | None = None,
) -> pd.Series:
    """Daily **log** returns of the red-thread portfolio, rebalanced every day.

    Log returns are not additive across assets, so the computation converts to
    simple returns, weights them, and converts back::

        r_p = log(1 + sum_j w_j (exp(r_j) - 1))

    Parameters
    ----------
    returns : DataFrame
        Daily log returns, as returned by :func:`load_returns`.
    weights : mapping or sequence, optional
        Asset weights.  A mapping selects the columns by name (default
        :data:`PORTFOLIO_WEIGHTS`: SP500 40 %, CAC40 20 %, AAPL 10 %, LVMH 10 %,
        GLD 10 %, TLT 10 %); a sequence must match the columns of ``returns``
        in order.  Weights must sum to 1.

    Returns
    -------
    pandas.Series
        Name ``'portfolio'``, index = the index of ``returns``, daily log
        returns of the rebalanced portfolio.

    Notes
    -----
    Daily rebalancing is an assumption, not a fact: it ignores transaction
    costs and it is what makes the portfolio return a weighted average of
    *simple* returns at each date.  On the full sample this reproduces the
    figures of ``stats_summary.md`` (annualised vol 13.4 %, max drawdown -26.0 %).

    Examples
    --------
    >>> rp = portfolio_returns(load_returns())        # doctest: +SKIP
    >>> round(float(rp.std(ddof=1) * np.sqrt(252)), 3)  # doctest: +SKIP
    0.134
    """
    if weights is None:
        weights = PORTFOLIO_WEIGHTS
    if isinstance(weights, Mapping):
        columns = list(weights.keys())
        missing = [c for c in columns if c not in returns.columns]
        if missing:
            raise KeyError(f"columns missing from returns: {missing}")
        w = np.asarray([float(weights[c]) for c in columns], dtype=float)
        data = returns[columns]
    else:
        w = np.asarray(list(weights), dtype=float)
        if w.size != returns.shape[1]:
            raise ValueError(
                f"weights has {w.size} entries but returns has {returns.shape[1]} columns"
            )
        data = returns
    if not np.isclose(w.sum(), 1.0):
        raise ValueError(f"weights must sum to 1, got {w.sum():.6f}")

    simple = np.expm1(data.to_numpy(dtype=float))
    portfolio_simple = simple @ w
    return pd.Series(np.log1p(portfolio_simple), index=data.index, name="portfolio")


# ---------------------------------------------------------------------------
# 6. Plotting
# ---------------------------------------------------------------------------


def set_style() -> None:
    """Apply the sober matplotlib style of the course (no seaborn, no extra dependency).

    Sets a default figure size of ``(7, 4)`` inches at 110 dpi, a light grid,
    no top/right spines and readable font sizes.  Call it once, in the imports
    cell of a notebook; it mutates ``matplotlib.rcParams`` in place and returns
    nothing.
    """
    mpl.rcParams.update(
        {
            "figure.figsize": (7.0, 4.0),
            "figure.dpi": 110,
            "savefig.dpi": 110,
            "figure.autolayout": True,
            "axes.grid": True,
            "grid.color": "0.85",
            "grid.linewidth": 0.6,
            "grid.alpha": 0.8,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.edgecolor": "0.3",
            "axes.titlesize": 11,
            "axes.titleweight": "bold",
            "axes.labelsize": 10,
            "font.size": 10,
            "legend.frameon": False,
            "legend.fontsize": 9,
            "lines.linewidth": 1.4,
            "xtick.labelsize": 9,
            "ytick.labelsize": 9,
            "xtick.direction": "out",
            "ytick.direction": "out",
        }
    )


# ---------------------------------------------------------------------------
# 7. Course v2 "de zero a heros": functions *given* to the beginner
# ---------------------------------------------------------------------------
#
# 00_ARCHITECTURE.md section 1.4: before chapter 5 the student writes only the
# fifteen numpy primitives; everything else is *provided* by this module and
# called, never written.  The names of this section are therefore in French
# (they are read aloud in the units), the docstrings stay in English like the
# rest of the module, and no pandas object ever crosses the interface: the
# beginner sees numpy arrays and plain dictionaries only (research_v2/
# 00_SYNTHESE_V2.md section 2, decision (iv)).
#
# These functions are thin wrappers over section 1-6 above: they add no new
# mathematics, only a smaller surface.  The advanced track ("voie rapide")
# keeps using the English names.


def charger_fil_rouge() -> dict[str, object]:
    """Load the red-thread data set as aligned numpy arrays (no pandas exposed).

    This is the single entry point to the data for the whole common track: it
    hides the ``DatetimeIndex``, the missing values and the time-series API of
    pandas behind three plain objects (an array of dates and two dictionaries
    of arrays), exactly as Data 8 hides them behind its ``Table``.

    Returns
    -------
    dict
        ``{"dates", "prix", "rendements_log", "poids", "r", "S0",
        "sigma_1y", "sigma_5y"}``:

        ``dates`` : ndarray of ``datetime64[D]``, shape ``(n,)``
            Trading days, increasing, one per row of the other arrays.
        ``prix`` : dict of str -> ndarray, shape ``(n,)``
            Closing price of each of the eight assets (``SP500``, ``SPY``,
            ``CAC40``, ``AAPL``, ``LVMH``, ``TTE``, ``GLD``, ``TLT``) in the
            currency of its listing place.
        ``rendements_log`` : dict of str -> ndarray, shape ``(n,)``
            Daily **log** returns ``log(P_t / P_{t-1})`` of the same assets, in
            decimal, on the **same** dates as ``prix``.
        ``poids`` : dict of str -> float
            The red-thread portfolio weights (:data:`PORTFOLIO_WEIGHTS`).
        ``r`` : float
            Risk-free rate, decimal (0.0375).
        ``S0`` : float
            Reference spot of the underlying, ``prix["SP500"][-1]`` (7718.60).
        ``sigma_1y``, ``sigma_5y`` : float
            Annualised volatilities of the underlying over the last 252 and
            1260 trading days (0.1284 and 0.1696).

    Notes
    -----
    **Alignment.** ``prix`` and ``rendements_log`` share one and the same date
    axis: the first session of the panel (2010-01-04) has no return, so it is
    dropped from *both*.  ``prix[a][k]`` and ``rendements_log[a][k]`` are
    therefore the price and the return of asset ``a`` on ``dates[k]``, and
    ``rendements_log[a][k] = log(prix[a][k] / prix[a][k - 1])`` for ``k >= 1``.

    The scalars are read from :data:`REFERENCE_PARAMS` and
    :data:`PORTFOLIO_WEIGHTS`, so they are stated in exactly one place in the
    whole course (``data/stats_summary.md`` -> ``REFERENCE_PARAMS`` -> here).

    Every call returns fresh arrays: mutating the result cannot poison a later
    call.

    Examples
    --------
    >>> d = charger_fil_rouge()                       # doctest: +SKIP
    >>> d["dates"].dtype, len(d["prix"]["SP500"])     # doctest: +SKIP
    (dtype('<M8[D]'), 4151)
    >>> round(d["S0"], 2), d["r"]                     # doctest: +SKIP
    (7718.6, 0.0375)
    """
    prices = _read_dated_csv("prices.csv")
    returns = _read_dated_csv("returns_daily.csv")
    # Same date axis for both: the first session has no return.
    common = prices.index.intersection(returns.index)
    prices = prices.loc[common]
    returns = returns.loc[common, prices.columns]

    dates = common.to_numpy().astype("datetime64[D]")
    prix = {col: np.ascontiguousarray(prices[col].to_numpy(dtype=float)) for col in prices.columns}
    rendements_log = {
        col: np.ascontiguousarray(returns[col].to_numpy(dtype=float)) for col in returns.columns
    }
    return {
        "dates": dates,
        "prix": prix,
        "rendements_log": rendements_log,
        "poids": dict(PORTFOLIO_WEIGHTS),
        "r": float(REFERENCE_PARAMS["r"]),
        "S0": float(REFERENCE_PARAMS["S0"]),
        "sigma_1y": float(REFERENCE_PARAMS["sigma_1y"]),
        "sigma_5y": float(REFERENCE_PARAMS["sigma_5y"]),
    }


def vol_portefeuille(
    rendements_log: Mapping[str, np.ndarray],
    poids: Mapping[str, float],
    periodes: int = 252,
) -> float:
    """Annualised volatility of the daily-rebalanced portfolio, from numpy arrays.

    Log returns do not add up across assets, so the computation goes through
    simple returns and back, exactly as :func:`portfolio_returns` does::

        r_p(t) = log(1 + sum_j w_j (exp(r_j(t)) - 1))
        vol    = sqrt(periodes) * std(r_p, ddof=1)

    Parameters
    ----------
    rendements_log : mapping of str -> ndarray
        Daily log returns per asset, in decimal, all of the same length and on
        the same dates (typically ``charger_fil_rouge()["rendements_log"]``).
    poids : mapping of str -> float
        Portfolio weights; the keys select the assets and must sum to 1
        (typically ``charger_fil_rouge()["poids"]``).
    periodes : int, optional
        Number of periods per year (default 252 trading days; using 365 on
        daily *trading* data is the classic annualisation error).

    Returns
    -------
    float
        Annualised volatility in decimal (0.1342 = 13.42 %).

    Raises
    ------
    KeyError
        If an asset of ``poids`` is missing from ``rendements_log``.
    ValueError
        If the weights do not sum to 1, if the series have different lengths,
        or if fewer than two dates are given.

    Notes
    -----
    Red-thread value (whole panel, weights 40/20/10/10/10/10):
    **0.1342**, i.e. the 13.40 % of ``data/stats_summary.md`` -- and far
    *below* the weighted average of the individual volatilities, 19.65 %,
    which is the whole point of chapter 1 unit 3 ("diversifying is not
    averaging": volatilities do not average, variances add with covariances).

    Examples
    --------
    >>> d = charger_fil_rouge()                                    # doctest: +SKIP
    >>> round(vol_portefeuille(d["rendements_log"], d["poids"]), 4)  # doctest: +SKIP
    0.1342
    """
    if periodes <= 0:
        raise ValueError("periodes must be strictly positive")
    noms = list(poids.keys())
    if not noms:
        raise ValueError("poids is empty")
    manquants = [a for a in noms if a not in rendements_log]
    if manquants:
        raise KeyError(f"assets missing from rendements_log: {manquants}")

    w = np.asarray([float(poids[a]) for a in noms], dtype=float)
    if not np.isclose(w.sum(), 1.0):
        raise ValueError(f"poids must sum to 1, got {w.sum():.6f}")

    colonnes = [np.asarray(rendements_log[a], dtype=float).ravel() for a in noms]
    longueurs = {c.size for c in colonnes}
    if len(longueurs) != 1:
        raise ValueError(f"the series have different lengths: {sorted(longueurs)}")
    if colonnes[0].size < 2:
        raise ValueError("at least 2 dates are needed to compute a volatility")

    simples = np.expm1(np.column_stack(colonnes))  # exp(r) - 1, per asset
    portefeuille = np.log1p(simples @ w)  # back to log returns
    return float(portefeuille.std(ddof=1) * np.sqrt(periodes))


def black_scholes_call(S0: float, K: float, T: float, r: float, sigma: float) -> float:
    """Black-Scholes price of a European **call**, without dividend yield.

    Named wrapper around ``black_scholes(..., kind="call")`` for the common
    track: five arguments, one number out, no ``kind`` string to remember and
    no ``q`` to forget.

    Parameters
    ----------
    S0, K : float
        Spot and strike, strictly positive, in the same currency.
    T : float
        Maturity in years, non-negative.
    r : float
        Continuously compounded risk-free rate, decimal (0.0375 for 3.75 %).
    sigma : float
        Annualised volatility, decimal (0.1284 for 12.84 %), non-negative.

    Returns
    -------
    float
        The price today, a *number* (never a random variable): this is the
        truth the Monte Carlo estimate of chapter 3 is compared to.

    Examples
    --------
    >>> round(black_scholes_call(7718.60, 7718.60, 1.0, 0.0375, 0.1284), 2)
    546.28
    >>> round(black_scholes_call(100.0, 100.0, 1.0, 0.05, 0.20), 4)
    10.4506
    """
    return float(black_scholes(S0, K, T, r, sigma, kind="call"))


def black_scholes_put(S0: float, K: float, T: float, r: float, sigma: float) -> float:
    """Black-Scholes price of a European **put**, without dividend yield.

    Named wrapper around ``black_scholes(..., kind="put")``; see
    :func:`black_scholes_call` for the arguments and their units.

    Returns
    -------
    float

    Notes
    -----
    Call-put parity holds exactly between the two wrappers:
    ``black_scholes_call(...) - black_scholes_put(...) = S0 - K exp(-rT)``.

    Examples
    --------
    >>> round(black_scholes_put(100.0, 100.0, 1.0, 0.05, 0.20), 4)
    5.5735
    >>> c = black_scholes_call(7718.60, 7718.60, 1.0, 0.0375, 0.1284)
    >>> p = black_scholes_put(7718.60, 7718.60, 1.0, 0.0375, 0.1284)
    >>> abs((c - p) - (7718.60 - 7718.60 * np.exp(-0.0375))) < 1e-9
    True
    """
    return float(black_scholes(S0, K, T, r, sigma, kind="put"))


def simuler_ST(
    S0: float,
    r: float,
    sigma: float,
    T: float,
    n: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Simulate ``n`` terminal prices under Q; produces n terminal prices whose discounted mean is S0.

    Black box of chapter 3 unit 5: the student calls it, marks the payoff,
    averages and discounts, without knowing yet *how* the prices are drawn --
    chapter 5 will open the box (``S_T = S0 exp((r - sigma^2 / 2) T + sigma
    sqrt(T) Z)``, the exact one-step geometric Brownian motion of
    :func:`simulate_gbm_terminal_q`).

    The contract, and the reason the drift is ``r`` and not ``mu``, is the pair
    of Goodman checks to be run **before** pricing anything:

    * a payoff always equal to ``K`` must be worth ``K exp(-rT)``;
    * a payoff equal to ``S_T`` must be worth ``S0`` -- that one *is* the
      martingale property, and it fails immediately if ``r`` is replaced by the
      historical drift ``mu``.

    Parameters
    ----------
    S0 : float
        Price today, strictly positive.
    r : float
        Risk-free rate, decimal; this is the drift **under Q** and the
        discount rate, and the two must be the same number.
    sigma : float
        Annualised volatility, decimal, non-negative.
    T : float
        Maturity in years, strictly positive.
    n : int
        Number of prices to draw.
    rng : numpy.random.Generator
        Source of randomness, always ``np.random.default_rng(SEED)`` or one of
        its ``rng.spawn(k)`` children; ``np.random.seed`` is banned.

    Returns
    -------
    ndarray
        Shape ``(n,)``, strictly positive, i.i.d.

    Examples
    --------
    >>> rng = np.random.default_rng(42)
    >>> S_T = simuler_ST(7718.60, 0.0375, 0.1284, 1.0, 100_000, rng)
    >>> S_T.shape
    (100000,)
    >>> abs(float(np.mean(np.exp(-0.0375) * S_T)) - 7718.60) < 30.0
    True
    """
    return simulate_gbm_terminal_q(S0, r, sigma, T, int(n), rng)


def payoff_call(S: float | np.ndarray, K: float) -> float | np.ndarray:
    """Payoff of a call at maturity, ``max(S - K, 0)``, vectorised.

    Parameters
    ----------
    S : float or ndarray
        Price(s) of the underlying at maturity.
    K : float
        Strike.

    Returns
    -------
    float or ndarray
        ``np.maximum(S - K, 0.0)``: a float for a scalar input, an array of the
        same shape otherwise.  Never negative -- and never the *profit*: the
        premium paid at inception is not subtracted here (chapter 1 unit 5).

    Examples
    --------
    >>> payoff_call(110.0, 100.0), payoff_call(90.0, 100.0)
    (10.0, 0.0)
    >>> payoff_call(np.array([90.0, 100.0, 110.0]), 100.0)
    array([ 0.,  0., 10.])
    """
    return _unwrap(np.maximum(np.asarray(S, dtype=float) - float(K), 0.0))


def payoff_put(S: float | np.ndarray, K: float) -> float | np.ndarray:
    """Payoff of a put at maturity, ``max(K - S, 0)``, vectorised.

    Parameters
    ----------
    S : float or ndarray
        Price(s) of the underlying at maturity.
    K : float
        Strike.

    Returns
    -------
    float or ndarray
        ``np.maximum(K - S, 0.0)``, of the shape of ``S``.

    Examples
    --------
    >>> payoff_put(90.0, 100.0), payoff_put(110.0, 100.0)
    (10.0, 0.0)
    >>> payoff_call(np.array([90.0, 110.0]), 100.0) - payoff_put(np.array([90.0, 110.0]), 100.0)
    array([-10.,  10.])
    """
    return _unwrap(np.maximum(float(K) - np.asarray(S, dtype=float), 0.0))


def verifier(condition: bool, message_ok: str, message_ko: str) -> None:
    """Self-correction check of the notebooks: print an explanatory message, raise if false.

    Third side of the Kaggle triptych ``verifier`` / :func:`indice` /
    :func:`solution`.  The rule of the course is that a failed check **never**
    says "false" alone: ``message_ko`` must say what was expected and where to
    look, so that a beginner working without a teacher can move on.

    Parameters
    ----------
    condition : bool
        The result of the test, e.g. ``abs(estimation - 546.28) < 1.0``.
    message_ok : str
        Printed when the check passes; say what has just been established, not
        merely "OK".
    message_ko : str
        Printed **and** used as the message of the ``AssertionError`` when the
        check fails; say what was expected and what to look at.

    Returns
    -------
    None
        The function prints; it returns nothing.

    Raises
    ------
    AssertionError
        With ``message_ko`` as its message, when ``condition`` is false.

    Examples
    --------
    >>> verifier(2 + 2 == 4, "OK : l'addition marche.", "2 + 2 devrait valoir 4.")
    OK : l'addition marche.
    >>> try:
    ...     verifier(False, "jamais", "attendu 4, obtenu 5 : relire la cellule ci-dessus.")
    ... except AssertionError as exc:
    ...     print(type(exc).__name__)
    RATE : attendu 4, obtenu 5 : relire la cellule ci-dessus.
    AssertionError
    """
    if bool(condition):
        print(str(message_ok))
        return
    texte = str(message_ko)
    print(f"RATE : {texte}")
    raise AssertionError(texte)


def indice(texte: str) -> None:
    """Print a hint, prefixed, in a notebook cell the student runs on demand.

    Second side of the triptych: the hint is one step of the reasoning, not the
    answer (which belongs to :func:`solution`).

    Parameters
    ----------
    texte : str
        The hint.

    Returns
    -------
    None

    Examples
    --------
    >>> indice("Le payoff est nul quand S_T < K : pensez a np.maximum.")
    INDICE : Le payoff est nul quand S_T < K : pensez a np.maximum.
    """
    print(f"INDICE : {texte}")


def solution(texte: str) -> None:
    """Print the answer, prefixed, in a cell the student runs only after trying.

    First side of the triptych to be written, last to be read: the unit places
    it in a folded cell *after* the check and the hint.

    Parameters
    ----------
    texte : str
        The answer, ideally with the one line of code that produces it.

    Returns
    -------
    None

    Examples
    --------
    >>> solution("prime = black_scholes_call(7718.60, 7718.60, 1.0, 0.0375, 0.1284)")
    SOLUTION : prime = black_scholes_call(7718.60, 7718.60, 1.0, 0.0375, 0.1284)
    """
    print(f"SOLUTION : {texte}")
