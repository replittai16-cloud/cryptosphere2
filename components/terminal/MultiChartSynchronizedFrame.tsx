'use client';

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  UTCTimestamp,
  Time,
  createSeriesMarkers,
  ISeriesMarkersPluginApi,
} from 'lightweight-charts';
import {
  Candle,
  LiquidityWall,
  LiquidationCluster,
  POI,
  TerminalToggles,
  TerminalLayoutMode,
  WhaleTradeSignal,
  DivergenceSignal,
  Timeframe,
} from '@/types/orderflow';
import { ThreeGravitationalCanvas } from './ThreeGravitationalCanvas';
import { DivergenceVisualizerHUD } from './DivergenceVisualizerHUD';
import { Plus, Minus, RotateCcw, Maximize2, Minimize2, HelpCircle } from 'lucide-react';

interface MultiChartSynchronizedFrameProps {
  candles: Candle[];
  liquidityWalls: LiquidityWall[];
  liquidationClusters: LiquidationCluster[];
  activePOIs: POI[];
  toggles: TerminalToggles;
  symbol: string;
  currentPrice: number;
  layoutMode: TerminalLayoutMode;
  onToggleLayoutMode: (mode: TerminalLayoutMode) => void;
  latestWhaleSignal?: WhaleTradeSignal | null;
  divergences?: DivergenceSignal[];
  onOpenGuide?: (tab?: 'PRESSURE' | 'CVD' | 'OI' | 'DOMINANCE' | 'WALLS' | 'WHALE') => void;
  timeframe?: Timeframe;
  isLoadingHistory?: boolean;
  onLoadEarlierHistory?: () => void;
}

const TV_THEME = {
  bg: '#131722',
  grid: 'rgba(255, 255, 255, 0.04)',
  panelBorder: '#2a2e39',
  scaleText: '#787b86',
  crosshair: '#787b86',
  bullish: '#089981',
  bearish: '#f23645',
};

const getCommonChartOptions = (container: HTMLElement, height: number, showTimeAxis: boolean) => ({
  width: container.clientWidth || 800,
  height: height > 0 ? height : 240,
  layout: {
    background: { type: ColorType.Solid, color: TV_THEME.bg },
    textColor: TV_THEME.scaleText,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, monospace',
    fontSize: 11,
  },
  grid: {
    vertLines: { color: TV_THEME.grid, style: LineStyle.Dotted },
    horzLines: { color: TV_THEME.grid, style: LineStyle.Dotted },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: TV_THEME.crosshair, style: LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
    horzLine: { color: TV_THEME.crosshair, style: LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
  },
  rightPriceScale: {
    borderColor: TV_THEME.panelBorder,
    visible: true,
    autoScale: true,
  },
  timeScale: {
    borderColor: TV_THEME.panelBorder,
    visible: showTimeAxis,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 12,
    barSpacing: 9,
    minBarSpacing: 0.5,
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: false,
    shiftVisibleRangeOnNewBar: true,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: {
      time: true,
      price: true,
    },
    mouseWheel: true,
    pinch: true,
  },
});

export const MultiChartSynchronizedFrame: React.FC<MultiChartSynchronizedFrameProps> = ({
  candles,
  liquidityWalls,
  activePOIs,
  toggles,
  symbol,
  currentPrice,
  layoutMode,
  latestWhaleSignal,
  divergences,
  onOpenGuide,
  timeframe = '15m',
  isLoadingHistory = false,
  onLoadEarlierHistory,
}) => {
  const [maximizedChart, setMaximizedChart] = useState<'PRICE' | 'PRESSURE' | 'CVD' | 'OI' | null>(null);

  // Containers
  const priceContainerRef = useRef<HTMLDivElement>(null);
  const pressureContainerRef = useRef<HTMLDivElement>(null);
  const cvdContainerRef = useRef<HTMLDivElement>(null);
  const oiContainerRef = useRef<HTMLDivElement>(null);

  // Chart APIs
  const priceChartRef = useRef<IChartApi | null>(null);
  const pressureChartRef = useRef<IChartApi | null>(null);
  const cvdChartRef = useRef<IChartApi | null>(null);
  const oiChartRef = useRef<IChartApi | null>(null);

  // Series APIs
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const pressureSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const cvdSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const subDeltaSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const oiSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const pressureMarkersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const cvdMarkersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<any[]>([]);

  const initialRangeSetRef = useRef<string>('');
  const onLoadEarlierHistoryRef = useRef(onLoadEarlierHistory);
  useEffect(() => {
    onLoadEarlierHistoryRef.current = onLoadEarlierHistory;
  }, [onLoadEarlierHistory]);

  // Synchronized visual divergence overlay lines and time guides
  const [divergenceOverlay, setDivergenceOverlay] = useState<{
    priceLines: { x1: number; y1: number; x2: number; y2: number; isBull: boolean; label: string; subLabel: string }[];
    pressureLines: { x1: number; y1: number; x2: number; y2: number; isBull: boolean; label: string; subLabel: string }[];
    cvdLines: { x1: number; y1: number; x2: number; y2: number; isBull: boolean; label: string; subLabel: string }[];
    timeSyncLines: { x1: number; x2: number; isBull: boolean; title: string }[];
  }>({ priceLines: [], pressureLines: [], cvdLines: [], timeSyncLines: [] });

  const [hoveredData, setHoveredData] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    delta: number;
    time: number;
  } | null>(null);

  const [priceDimensions, setPriceDimensions] = useState({ width: 800, height: 450 });

  const candlesRef = useRef<Candle[]>(candles);
  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  // Suppress transient 'Object is disposed' errors from lightweight-charts / fancy-canvas during DOM teardown/re-render
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      if (
        (event?.message && typeof event.message === 'string' && event.message.includes('Object is disposed')) ||
        (event?.error?.message && typeof event.error.message === 'string' && event.error.message.includes('Object is disposed'))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (
        (event?.reason?.message && typeof event.reason.message === 'string' && event.reason.message.includes('Object is disposed')) ||
        (typeof event?.reason === 'string' && event.reason.includes('Object is disposed'))
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener('error', handleGlobalError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleGlobalError, true);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Transform and strictly validate candle data for all 4 charts
  const chartData = useMemo(() => {
    const map = new Map<number, Candle>();
    candles.forEach((c) => {
      const sec = Math.floor(c.time / 1000);
      map.set(sec, c);
    });

    const sorted = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);

    // 1. Price candles
    const priceList = sorted
      .map(([sec, c]) => {
        const o = Number(c.open);
        const cl = Number(c.close);
        const rawH = Number(c.high);
        const rawL = Number(c.low);
        const h = Math.max(o, cl, !isNaN(rawH) ? rawH : Math.max(o, cl));
        const l = Math.min(o, cl, !isNaN(rawL) ? rawL : Math.min(o, cl));
        return {
          time: sec as UTCTimestamp,
          open: o,
          high: h,
          low: l,
          close: cl,
        };
      })
      .filter((d) => !isNaN(d.open) && !isNaN(d.close));

    // 2. Volume histogram
    const volumeList = sorted.map(([sec, c]) => ({
      time: sec as UTCTimestamp,
      value: Number(c.volume) || 0,
      color: c.close >= c.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)',
    }));

    // 3. Pressure candles (Directional CPP Candlesticks with authentic highs and lows)
    const pressureList = sorted
      .map(([sec, c]) => {
        const o = typeof c.pressureOpen === 'number' && !isNaN(c.pressureOpen) ? c.pressureOpen : 0;
        const cl = typeof c.pressureClose === 'number' && !isNaN(c.pressureClose) ? c.pressureClose : 0;
        const swing = Math.max(2.5, Math.abs(cl - o));
        const rawH = typeof c.pressureHigh === 'number' && !isNaN(c.pressureHigh) ? c.pressureHigh : Math.max(o, cl) + swing * 0.35;
        const rawL = typeof c.pressureLow === 'number' && !isNaN(c.pressureLow) ? c.pressureLow : Math.min(o, cl) - swing * 0.35;
        const h = Math.max(o, cl, rawH);
        const l = Math.min(o, cl, rawL);
        return {
          time: sec as UTCTimestamp,
          open: o,
          high: h,
          low: l,
          close: cl,
        };
      })
      .filter((d) => !isNaN(d.open) && !isNaN(d.close));

    // 4. CVD candles
    const cvdList = sorted
      .map(([sec, c]) => {
        const o = typeof c.cvdOpen === 'number' && !isNaN(c.cvdOpen) ? c.cvdOpen : c.cumulativeDelta || 0;
        const cl = typeof c.cvdClose === 'number' && !isNaN(c.cvdClose) ? c.cvdClose : c.cumulativeDelta || 0;
        const swing = Math.max(1, Math.abs(cl - o));
        const rawH = typeof c.cvdHigh === 'number' && !isNaN(c.cvdHigh) ? c.cvdHigh : Math.max(o, cl) + swing * 0.25;
        const rawL = typeof c.cvdLow === 'number' && !isNaN(c.cvdLow) ? c.cvdLow : Math.min(o, cl) - swing * 0.25;
        const h = Math.max(o, cl, rawH);
        const l = Math.min(o, cl, rawL);
        return {
          time: sec as UTCTimestamp,
          open: o,
          high: h,
          low: l,
          close: cl,
        };
      })
      .filter((d) => !isNaN(d.open) && !isNaN(d.close));

    // 5. Sub-bar Delta histogram
    const subDeltaList = sorted.map(([sec, c]) => ({
      time: sec as UTCTimestamp,
      value: typeof c.delta === 'number' && !isNaN(c.delta) ? c.delta : 0,
      color: (c.delta || 0) >= 0 ? 'rgba(8, 153, 129, 0.45)' : 'rgba(242, 54, 69, 0.45)',
    }));

    // 6. OI candles
    const oiList = sorted
      .map(([sec, c]) => {
        const o = typeof c.oiOpen === 'number' && !isNaN(c.oiOpen) ? c.oiOpen : c.oi || 150000000;
        const cl = typeof c.oiClose === 'number' && !isNaN(c.oiClose) ? c.oiClose : c.oi || 150000000;
        const swing = Math.max(1000, Math.abs(cl - o));
        const rawH = typeof c.oiHigh === 'number' && !isNaN(c.oiHigh) ? c.oiHigh : Math.max(o, cl) + swing * 0.3;
        const rawL = typeof c.oiLow === 'number' && !isNaN(c.oiLow) ? c.oiLow : Math.min(o, cl) - swing * 0.3;
        const h = Math.max(o, cl, rawH);
        const l = Math.min(o, cl, rawL);
        return {
          time: sec as UTCTimestamp,
          open: o,
          high: h,
          low: l,
          close: cl,
        };
      })
      .filter((d) => !isNaN(d.open) && !isNaN(d.close));

    return {
      priceList,
      volumeList,
      pressureList,
      cvdList,
      subDeltaList,
      oiList,
      lastCandle: sorted.length > 0 ? sorted[sorted.length - 1][1] : null,
    };
  }, [candles]);

  // Compute pixel coordinates for synchronized divergence trendlines and time-sync lines safely
  const updateDivergenceCoordinates = useCallback(() => {
    try {
      if (!divergences || divergences.length === 0 || !toggles.divergenceRadar) {
        setDivergenceOverlay({ priceLines: [], pressureLines: [], cvdLines: [], timeSyncLines: [] });
        return;
      }

      const priceChart = priceChartRef.current;
      const priceSeries = priceSeriesRef.current;
      const pressChart = pressureChartRef.current;
      const pressSeries = pressureSeriesRef.current;
      const cvdChart = cvdChartRef.current;
      const cvdSeries = cvdSeriesRef.current;

      if (!priceChart || !priceSeries) return;

      const pLines: any[] = [];
      const prLines: any[] = [];
      const cLines: any[] = [];
      const tLines: any[] = [];

      // Focus on active recent divergences
      const activeDivs = divergences.slice(0, 3);

      activeDivs.forEach((d) => {
        try {
          const t1 = Math.floor(d.fromTimestamp / 1000) as UTCTimestamp;
          const t2 = Math.floor(d.toTimestamp / 1000) as UTCTimestamp;
          const isBull = d.direction === 'BULLISH';

          const x1 = priceChart.timeScale().timeToCoordinate(t1);
          const x2 = priceChart.timeScale().timeToCoordinate(t2);

          if (x1 !== null && x2 !== null && Math.abs(x2 - x1) > 4) {
            // Price Chart Line
            const y1_p = priceSeries.priceToCoordinate(d.price1);
            const y2_p = priceSeries.priceToCoordinate(d.price2);
            if (y1_p !== null && y2_p !== null) {
              const pct = (((d.price2 - d.price1) / (d.price1 || 1)) * 100).toFixed(1);
              const sign = +pct >= 0 ? '+' : '';
              pLines.push({
                x1,
                y1: y1_p,
                x2,
                y2: y2_p,
                isBull,
                label: `PRICE ${d.price2 >= d.price1 ? 'HIGHER HIGH' : 'LOWER LOW'} (${sign}${pct}%)`,
                subLabel: `$${d.price1.toFixed(0)} ➔ $${d.price2.toFixed(0)}`,
              });
            }

            // Pressure Chart Line
            if (pressChart && pressSeries) {
              try {
                const y1_pr = pressSeries.priceToCoordinate(d.indicator1);
                const y2_pr = pressSeries.priceToCoordinate(d.indicator2);
                if (y1_pr !== null && y2_pr !== null) {
                  const diff = (d.indicator2 - d.indicator1).toFixed(1);
                  const sign = +diff >= 0 ? '+' : '';
                  prLines.push({
                    x1,
                    y1: y1_pr,
                    x2,
                    y2: y2_pr,
                    isBull,
                    label: `PRESSURE ${d.indicator2 >= d.indicator1 ? 'HIGHER LOW (ABSORPTION)' : 'LOWER HIGH (EXHAUSTION)'} (${sign}${diff} CPP)`,
                    subLabel: `${d.indicator1.toFixed(1)} ➔ ${d.indicator2.toFixed(1)} CPP`,
                  });
                }
              } catch {}
            }

            // CVD Chart Line (when category is PRESSURE_VS_CVD)
            if (d.category === 'PRESSURE_VS_CVD' && cvdChart && cvdSeries && typeof d.secondaryIndicator1 === 'number' && typeof d.secondaryIndicator2 === 'number') {
              try {
                const y1_c = cvdSeries.priceToCoordinate(d.secondaryIndicator1);
                const y2_c = cvdSeries.priceToCoordinate(d.secondaryIndicator2);
                if (y1_c !== null && y2_c !== null) {
                  const cvdDiff = (d.secondaryIndicator2 - d.secondaryIndicator1).toFixed(0);
                  const sign = +cvdDiff >= 0 ? '+' : '';
                  cLines.push({
                    x1,
                    y1: y1_c,
                    x2,
                    y2: y2_c,
                    isBull,
                    label: `CVD ${d.secondaryIndicator2 >= d.secondaryIndicator1 ? 'HIGHER HIGH (TRAPPED BUYS)' : 'LOWER LOW (ABSORBED SELLS)'} (${sign}${cvdDiff} Δ)`,
                    subLabel: `${d.secondaryIndicator1.toFixed(0)} ➔ ${d.secondaryIndicator2.toFixed(0)} Δ`,
                  });
                }
              } catch {}
            }

            tLines.push({ x1, x2, isBull, title: d.title });
          }
        } catch {}
      });

      setDivergenceOverlay({ priceLines: pLines, pressureLines: prLines, cvdLines: cLines, timeSyncLines: tLines });
    } catch {}
  }, [divergences, toggles.divergenceRadar]);

  // Keep latest updateDivergenceCoordinates in ref so synchronization effect does not re-subscribe on every tick
  const updateDivergenceCoordinatesRef = useRef(updateDivergenceCoordinates);
  useEffect(() => {
    updateDivergenceCoordinatesRef.current = updateDivergenceCoordinates;
  }, [updateDivergenceCoordinates]);

  // Synchronize logical range across all charts safely with clean unsubscription
  useEffect(() => {
    const charts: IChartApi[] = [];
    if (priceChartRef.current) charts.push(priceChartRef.current);
    if (pressureChartRef.current) charts.push(pressureChartRef.current);
    if (cvdChartRef.current) charts.push(cvdChartRef.current);
    if (oiChartRef.current) charts.push(oiChartRef.current);

    if (charts.length < 2) return;

    let isSyncing = false;
    let isTornDown = false;
    const unsubscribers: (() => void)[] = [];

    charts.forEach((chart) => {
      const handler = (range: any) => {
        if (isSyncing || !range || isTornDown) return;
        isSyncing = true;
        charts.forEach((other) => {
          if (other !== chart && !isTornDown) {
            try {
              other.timeScale().setVisibleLogicalRange(range);
            } catch {}
          }
        });
        isSyncing = false;
        requestAnimationFrame(() => {
          if (!isTornDown) {
            try {
              updateDivergenceCoordinatesRef.current?.();
            } catch {}
          }
        });
      };

      try {
        chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
        unsubscribers.push(() => {
          try {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
          } catch {}
        });
      } catch {}
    });

    return () => {
      isTornDown = true;
      unsubscribers.forEach((unsub) => {
        try {
          unsub();
        } catch {}
      });
    };
  }, [layoutMode, maximizedChart]);

  // 1. Initialize Primary TradingView Price Chart
  useEffect(() => {
    if (!priceContainerRef.current) return;
    const container = priceContainerRef.current;
    let isDisposed = false;

    try {
      container.innerHTML = '';
    } catch {}

    let chart: IChartApi;
    try {
      chart = createChart(container, {
        ...getCommonChartOptions(container, container.clientHeight || 300, true),
      });
    } catch {
      return;
    }

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: TV_THEME.bullish,
      downColor: TV_THEME.bearish,
      borderVisible: true,
      borderUpColor: TV_THEME.bullish,
      borderDownColor: TV_THEME.bearish,
      wickUpColor: TV_THEME.bullish,
      wickDownColor: TV_THEME.bearish,
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const crosshairHandler = (param: any) => {
      if (isDisposed) return;
      try {
        if (param.time && param.seriesData) {
          const data = param.seriesData.get(candleSeries) as any;
          if (data) {
            const matchCandle = candlesRef.current.find((c) => Math.floor(c.time / 1000) === (param.time as number));
            setHoveredData({
              open: data.open,
              high: data.high,
              low: data.low,
              close: data.close,
              volume: matchCandle?.volume || 0,
              delta: matchCandle?.delta || (data.close - data.open),
              time: (param.time as number) * 1000,
            });
          }
        } else {
          setHoveredData(null);
        }
      } catch {}
    };

    try {
      chart.subscribeCrosshairMove(crosshairHandler);
    } catch {}

    // Populate data immediately if available
    try {
      if (chartData.priceList.length > 0) {
        candleSeries.setData(chartData.priceList);
      }
      if (chartData.volumeList.length > 0) {
        volSeries.setData(chartData.volumeList);
      }
    } catch {}

    priceChartRef.current = chart;
    priceSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volSeries;

    const handleResize = () => {
      if (isDisposed) return;
      try {
        if (container && chart && container.clientWidth > 0 && container.clientHeight > 0) {
          chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
          setPriceDimensions({ width: container.clientWidth, height: container.clientHeight });
        }
      } catch {}
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      isDisposed = true;
      try {
        observer.disconnect();
      } catch {}
      try {
        chart.unsubscribeCrosshairMove(crosshairHandler);
      } catch {}
      if (markersPluginRef.current) {
        try {
          markersPluginRef.current.detach();
        } catch {}
        markersPluginRef.current = null;
      }
      priceLinesRef.current.forEach((pl) => {
        try {
          candleSeries.removePriceLine(pl);
        } catch {}
      });
      priceLinesRef.current = [];
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceChartRef.current = null;
      try {
        chart.remove();
      } catch {}
      try {
        container.innerHTML = '';
      } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Initialize Cumulative Price Pressure Chart
  useEffect(() => {
    if (!pressureContainerRef.current) return;
    const container = pressureContainerRef.current;
    let isDisposed = false;

    try {
      container.innerHTML = '';
    } catch {}

    let chart: IChartApi;
    try {
      chart = createChart(container, {
        ...getCommonChartOptions(container, container.clientHeight || 240, true),
      });
    } catch {
      return;
    }

    const series = chart.addSeries(CandlestickSeries, {
      upColor: TV_THEME.bullish,
      downColor: TV_THEME.bearish,
      borderVisible: true,
      borderUpColor: TV_THEME.bullish,
      borderDownColor: TV_THEME.bearish,
      wickUpColor: TV_THEME.bullish,
      wickDownColor: TV_THEME.bearish,
    });

    // Populate data immediately if available
    try {
      if (chartData.pressureList.length > 0) {
        series.setData(chartData.pressureList);
      }
    } catch {}

    pressureChartRef.current = chart;
    pressureSeriesRef.current = series;

    const handleResize = () => {
      if (isDisposed) return;
      try {
        if (container && chart && container.clientWidth > 0 && container.clientHeight > 0) {
          chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        }
      } catch {}
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      isDisposed = true;
      try {
        observer.disconnect();
      } catch {}
      if (pressureMarkersPluginRef.current) {
        try {
          pressureMarkersPluginRef.current.detach();
        } catch {}
        pressureMarkersPluginRef.current = null;
      }
      pressureSeriesRef.current = null;
      pressureChartRef.current = null;
      try {
        chart.remove();
      } catch {}
      try {
        container.innerHTML = '';
      } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. Initialize Cumulative Volume Delta (CVD) Chart
  useEffect(() => {
    if (!cvdContainerRef.current) return;
    const container = cvdContainerRef.current;
    let isDisposed = false;

    try {
      container.innerHTML = '';
    } catch {}

    let chart: IChartApi;
    try {
      chart = createChart(container, {
        ...getCommonChartOptions(container, container.clientHeight || 240, true),
      });
    } catch {
      return;
    }

    const series = chart.addSeries(CandlestickSeries, {
      upColor: TV_THEME.bullish,
      downColor: TV_THEME.bearish,
      borderVisible: true,
      borderUpColor: TV_THEME.bullish,
      borderDownColor: TV_THEME.bearish,
      wickUpColor: TV_THEME.bullish,
      wickDownColor: TV_THEME.bearish,
    });

    const subDeltaSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: '',
    });
    subDeltaSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });

    // Populate data immediately if available
    try {
      if (chartData.cvdList.length > 0) {
        series.setData(chartData.cvdList);
      }
      if (chartData.subDeltaList.length > 0) {
        subDeltaSeries.setData(chartData.subDeltaList);
      }
    } catch {}

    cvdChartRef.current = chart;
    cvdSeriesRef.current = series;
    subDeltaSeriesRef.current = subDeltaSeries;

    const handleResize = () => {
      if (isDisposed) return;
      try {
        if (container && chart && container.clientWidth > 0 && container.clientHeight > 0) {
          chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        }
      } catch {}
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      isDisposed = true;
      try {
        observer.disconnect();
      } catch {}
      if (cvdMarkersPluginRef.current) {
        try {
          cvdMarkersPluginRef.current.detach();
        } catch {}
        cvdMarkersPluginRef.current = null;
      }
      cvdSeriesRef.current = null;
      subDeltaSeriesRef.current = null;
      cvdChartRef.current = null;
      try {
        chart.remove();
      } catch {}
      try {
        container.innerHTML = '';
      } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Initialize Open Interest (OI) Chart
  useEffect(() => {
    if (!oiContainerRef.current) return;
    const container = oiContainerRef.current;
    let isDisposed = false;

    try {
      container.innerHTML = '';
    } catch {}

    let chart: IChartApi;
    try {
      chart = createChart(container, {
        ...getCommonChartOptions(container, container.clientHeight || 240, true),
      });
    } catch {
      return;
    }

    const series = chart.addSeries(CandlestickSeries, {
      upColor: TV_THEME.bullish,
      downColor: TV_THEME.bearish,
      borderVisible: true,
      borderUpColor: TV_THEME.bullish,
      borderDownColor: TV_THEME.bearish,
      wickUpColor: TV_THEME.bullish,
      wickDownColor: TV_THEME.bearish,
    });

    // Populate data immediately if available
    try {
      if (chartData.oiList.length > 0) {
        series.setData(chartData.oiList);
      }
    } catch {}

    oiChartRef.current = chart;
    oiSeriesRef.current = series;

    const handleResize = () => {
      if (isDisposed) return;
      try {
        if (container && chart && container.clientWidth > 0 && container.clientHeight > 0) {
          chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        }
      } catch {}
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      isDisposed = true;
      try {
        observer.disconnect();
      } catch {}
      oiSeriesRef.current = null;
      oiChartRef.current = null;
      try {
        chart.remove();
      } catch {}
      try {
        container.innerHTML = '';
      } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update Data across all series whenever chartData changes safely
  useEffect(() => {
    try {
      if (priceSeriesRef.current && chartData.priceList.length > 0) {
        priceSeriesRef.current.setData(chartData.priceList);
      }
    } catch {}
    try {
      if (volumeSeriesRef.current && chartData.volumeList.length > 0) {
        volumeSeriesRef.current.setData(chartData.volumeList);
      }
    } catch {}
    try {
      if (pressureSeriesRef.current && chartData.pressureList.length > 0) {
        pressureSeriesRef.current.setData(chartData.pressureList);
      }
    } catch {}
    try {
      if (cvdSeriesRef.current && chartData.cvdList.length > 0) {
        cvdSeriesRef.current.setData(chartData.cvdList);
      }
    } catch {}
    try {
      if (subDeltaSeriesRef.current && chartData.subDeltaList.length > 0) {
        subDeltaSeriesRef.current.setData(chartData.subDeltaList);
      }
    } catch {}
    try {
      if (oiSeriesRef.current && chartData.oiList.length > 0) {
        oiSeriesRef.current.setData(chartData.oiList);
      }
    } catch {}

    // Attach Whale and Divergence Markers across all charts
    const priceMarkers: any[] = [];
    const pressureMarkers: any[] = [];
    const cvdMarkers: any[] = [];

    if (toggles.divergenceRadar && divergences && divergences.length > 0) {
      divergences.forEach((d) => {
        const sec1 = Math.floor(d.fromTimestamp / 1000) as UTCTimestamp;
        const sec2 = Math.floor(d.toTimestamp / 1000) as UTCTimestamp;
        const isBull = d.direction === 'BULLISH';

        if (d.category === 'PRICE_VS_PRESSURE') {
          // Chart 1 (Price)
          priceMarkers.push({
            time: sec1,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: '#38bdf8',
            shape: 'circle' as const,
            text: isBull ? 'VALLEY 1' : 'PEAK 1',
          });
          priceMarkers.push({
            time: sec2,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: isBull ? '#089981' : '#f23645',
            shape: isBull ? ('arrowUp' as const) : ('arrowDown' as const),
            text: isBull ? '▲ BULL DIV (PRICE LL)' : '▼ BEAR DIV (PRICE HH)',
          });

          // Chart 2 (Price Pressure)
          pressureMarkers.push({
            time: sec1,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: '#38bdf8',
            shape: 'circle' as const,
            text: 'CPP P1',
          });
          pressureMarkers.push({
            time: sec2,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: isBull ? '#089981' : '#f23645',
            shape: isBull ? ('arrowUp' as const) : ('arrowDown' as const),
            text: isBull ? '▲ PRESS HL (ABSORPTION)' : '▼ PRESS LH (EXHAUSTION)',
          });
        } else if (d.category === 'PRESSURE_VS_CVD') {
          // Chart 2 (Price Pressure)
          pressureMarkers.push({
            time: sec1,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: '#a855f7',
            shape: 'circle' as const,
            text: 'CPP P1',
          });
          pressureMarkers.push({
            time: sec2,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: isBull ? '#089981' : '#f23645',
            shape: isBull ? ('arrowUp' as const) : ('arrowDown' as const),
            text: isBull ? '▲ ICEBERG BID WALL (PRESS HL)' : '▼ ICEBERG ASK DUMP (PRESS LH)',
          });

          // Chart 3 (CVD)
          cvdMarkers.push({
            time: sec1,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: '#a855f7',
            shape: 'circle' as const,
            text: 'CVD 1',
          });
          cvdMarkers.push({
            time: sec2,
            position: isBull ? ('belowBar' as const) : ('aboveBar' as const),
            color: isBull ? '#089981' : '#f23645',
            shape: isBull ? ('arrowUp' as const) : ('arrowDown' as const),
            text: isBull ? '▲ CVD LL (PANIC SELLS ABSORBED)' : '▼ CVD HH (RETAIL BUYS TRAPPED)',
          });
        }
      });
    }

    if (latestWhaleSignal && latestWhaleSignal.symbol === symbol && chartData.lastCandle) {
      const isBuy = latestWhaleSignal.side === 'BUY';
      const lastSec = Math.floor(chartData.lastCandle.time / 1000) as UTCTimestamp;
      priceMarkers.push({
        time: lastSec,
        position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
        color: isBuy ? '#089981' : '#f23645',
        shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
        text: `WHALE ${latestWhaleSignal.side} $${(latestWhaleSignal.sizeUSDT / 1000000).toFixed(1)}M`,
      });
    }

    priceMarkers.sort((a, b) => (a.time as number) - (b.time as number));
    pressureMarkers.sort((a, b) => (a.time as number) - (b.time as number));
    cvdMarkers.sort((a, b) => (a.time as number) - (b.time as number));

    try {
      if (priceSeriesRef.current) {
        if (priceMarkers.length > 0) {
          if (!markersPluginRef.current) {
            markersPluginRef.current = createSeriesMarkers(priceSeriesRef.current, priceMarkers);
          } else {
            markersPluginRef.current.setMarkers(priceMarkers);
          }
        } else if (markersPluginRef.current) {
          try {
            markersPluginRef.current.setMarkers([]);
          } catch {}
        }
      }
    } catch {
      if (markersPluginRef.current) {
        try { markersPluginRef.current.detach(); } catch {}
      }
      markersPluginRef.current = null;
    }

    try {
      if (pressureSeriesRef.current) {
        if (pressureMarkers.length > 0) {
          if (!pressureMarkersPluginRef.current) {
            pressureMarkersPluginRef.current = createSeriesMarkers(pressureSeriesRef.current, pressureMarkers);
          } else {
            pressureMarkersPluginRef.current.setMarkers(pressureMarkers);
          }
        } else if (pressureMarkersPluginRef.current) {
          try {
            pressureMarkersPluginRef.current.setMarkers([]);
          } catch {}
        }
      }
    } catch {
      if (pressureMarkersPluginRef.current) {
        try { pressureMarkersPluginRef.current.detach(); } catch {}
      }
      pressureMarkersPluginRef.current = null;
    }

    try {
      if (cvdSeriesRef.current) {
        if (cvdMarkers.length > 0) {
          if (!cvdMarkersPluginRef.current) {
            cvdMarkersPluginRef.current = createSeriesMarkers(cvdSeriesRef.current, cvdMarkers);
          } else {
            cvdMarkersPluginRef.current.setMarkers(cvdMarkers);
          }
        } else if (cvdMarkersPluginRef.current) {
          try {
            cvdMarkersPluginRef.current.setMarkers([]);
          } catch {}
        }
      }
    } catch {
      if (cvdMarkersPluginRef.current) {
        try { cvdMarkersPluginRef.current.detach(); } catch {}
      }
      cvdMarkersPluginRef.current = null;
    }

    // Refresh overlay coordinates
    try {
      updateDivergenceCoordinatesRef.current?.();
    } catch {}
  }, [chartData, latestWhaleSignal, symbol, divergences, toggles.divergenceRadar]);

  // Update Liquidity Walls as native PriceLines safely
  useEffect(() => {
    if (!priceSeriesRef.current) return;
    const series = priceSeriesRef.current;

    priceLinesRef.current.forEach((pl) => {
      try {
        series.removePriceLine(pl);
      } catch {}
    });
    priceLinesRef.current = [];

    if (toggles.liquidityWalls && liquidityWalls.length > 0) {
      liquidityWalls.slice(0, 8).forEach((w) => {
        try {
          const isBid = w.side === 'bid';
          const pl = series.createPriceLine({
            price: w.price,
            color: isBid ? '#089981' : '#f23645',
            lineWidth: w.isBeingTested ? 2 : 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${isBid ? 'BID' : 'ASK'} $${(w.sizeUSDT / 1000000).toFixed(1)}M`,
          });
          priceLinesRef.current.push(pl);
        } catch {}
      });
    }
  }, [liquidityWalls, toggles.liquidityWalls]);

  // Determine visibility of each chart panel
  const showPrice = maximizedChart === null ? true : maximizedChart === 'PRICE';
  const showPressure =
    maximizedChart === 'PRESSURE' ||
    (maximizedChart === null && layoutMode === 'QUAD_MATRIX' && toggles.cumulativePressure);
  const showCVD =
    maximizedChart === 'CVD' ||
    (maximizedChart === null && layoutMode !== 'FULL_CHART' && toggles.cvdSubBar);
  const showOI =
    maximizedChart === 'OI' ||
    (maximizedChart === null && layoutMode === 'QUAD_MATRIX' && toggles.oiFunding);

  // Resize charts whenever visibility, layout, or maximization changes
  useEffect(() => {
    let isCancelled = false;
    const timer = setTimeout(() => {
      if (isCancelled) return;
      const items = [
        { chart: priceChartRef.current, container: priceContainerRef.current, visible: showPrice },
        { chart: pressureChartRef.current, container: pressureContainerRef.current, visible: showPressure },
        { chart: cvdChartRef.current, container: cvdContainerRef.current, visible: showCVD },
        { chart: oiChartRef.current, container: oiContainerRef.current, visible: showOI },
      ];

      items.forEach(({ chart, container, visible }) => {
        if (chart && container && visible && !isCancelled) {
          const w = container.clientWidth;
          const h = container.clientHeight;
          if (w > 0 && h > 0) {
            try {
              chart.applyOptions({ width: w, height: h });
            } catch {}
          }
        }
      });
    }, 40);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [maximizedChart, layoutMode, showPrice, showPressure, showCVD, showOI]);

  // Auto-frame initial logical range to recent ~130 candles while maintaining full historical access to genesis
  useEffect(() => {
    const key = `${symbol}_${timeframe}`;
    if (chartData.priceList.length > 0 && initialRangeSetRef.current !== key) {
      initialRangeSetRef.current = key;
      const total = chartData.priceList.length;
      if (priceChartRef.current) {
        const from = Math.max(0, total - 130);
        const to = total + 5;
        try {
          priceChartRef.current.timeScale().setVisibleLogicalRange({ from, to });
        } catch {}
      }
    }
  }, [chartData.priceList.length, symbol, timeframe]);

  // Jump to specific historical macro window or full crypto inception
  const jumpRange = (range: 'ALL' | '5Y' | '1Y' | 'YTD' | 'RECENT') => {
    if (!priceChartRef.current || chartData.priceList.length === 0) return;
    try {
      const total = chartData.priceList.length;
      if (range === 'ALL') {
        priceChartRef.current.timeScale().fitContent();
      } else if (range === 'RECENT') {
        const from = Math.max(0, total - 130);
        priceChartRef.current.timeScale().setVisibleLogicalRange({ from, to: total + 5 });
      } else {
        const nowSec = Math.floor(Date.now() / 1000);
        let targetSec = nowSec;
        if (range === '5Y') targetSec = nowSec - 5 * 365 * 24 * 3600;
        else if (range === '1Y') targetSec = nowSec - 365 * 24 * 3600;
        else if (range === 'YTD') {
          const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
          targetSec = yearStart;
        }
        const idx = chartData.priceList.findIndex((c) => (c.time as number) >= targetSec);
        const fromIdx = idx >= 0 ? idx : Math.max(0, total - 365);
        priceChartRef.current.timeScale().setVisibleLogicalRange({ from: fromIdx, to: total + 5 });
      }
    } catch {}
  };

  // Generic Zoom and Pan helpers safely protected
  const zoomChart = (chart: IChartApi | null, factor: number) => {
    if (!chart) return;
    try {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) {
        const span = range.to - range.from;
        const delta = Math.max(1, Math.round(span * factor));
        chart.timeScale().setVisibleLogicalRange({ from: range.from + delta, to: range.to - delta });
      }
    } catch {}
  };

  const resetChart = (chart: IChartApi | null) => {
    if (!chart) return;
    try {
      chart.timeScale().fitContent();
    } catch {}
  };

  const toggleMaximize = (target: 'PRICE' | 'PRESSURE' | 'CVD' | 'OI') => {
    if (maximizedChart === target) {
      setMaximizedChart(null);
    } else {
      setMaximizedChart(target);
    }
  };

  const activeCandle = hoveredData || chartData.lastCandle;

  const firstCandleTime = chartData.priceList.length > 0 ? (chartData.priceList[0].time as number) * 1000 : 0;
  const firstDateLabel = firstCandleTime > 0
    ? new Date(firstCandleTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
    : '2017';

  return (
    <div className="relative flex flex-col w-full h-full select-none overflow-hidden bg-[#131722] border border-[#2a2e39]">
      {/* Live Divergence Radar Banner */}
      {toggles.divergenceRadar && divergences && divergences.length > 0 && (
        <DivergenceVisualizerHUD divergences={divergences} />
      )}

      {/* 1. Primary Candlestick Chart */}
      <div
        className={`relative w-full flex-1 min-h-0 ${showPrice ? 'flex flex-col' : 'hidden'} ${
          showPressure || showCVD || showOI ? 'border-b border-[#2a2e39]' : ''
        }`}
      >
        {/* TradingView Legend HUD */}
        <div className="absolute top-2 left-3 z-30 flex flex-wrap items-center gap-3 text-xs font-mono bg-[#1e222d]/90 px-3 py-1.5 rounded border border-[#2a2e39] backdrop-blur-md shadow-lg pointer-events-auto">
          <span className="font-bold text-sky-400">{symbol}</span>
          <span>
            O <span className="tabular-nums font-semibold text-white">${activeCandle?.open.toFixed(2)}</span>
          </span>
          <span>
            H <span className="tabular-nums font-semibold text-white">${activeCandle?.high.toFixed(2)}</span>
          </span>
          <span>
            L <span className="tabular-nums font-semibold text-white">${activeCandle?.low.toFixed(2)}</span>
          </span>
          <span>
            C <span className="tabular-nums font-semibold text-white">${activeCandle?.close.toFixed(2)}</span>
          </span>
          <span>
            VOL <span className="tabular-nums font-medium text-neutral-300">{activeCandle?.volume.toLocaleString()}</span>
          </span>
          <span>
            Δ{' '}
            <span
              className={`tabular-nums font-bold ${
                (activeCandle?.delta || 0) >= 0 ? 'text-[#089981]' : 'text-[#f23645]'
              }`}
            >
              {(activeCandle?.delta || 0) >= 0 ? '+' : ''}
              {(activeCandle?.delta || 0).toFixed(1)}
            </span>
          </span>

          {/* Historical Bars Count & Genesis Date Badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 text-sky-300 font-mono text-[10px] font-bold">
            <span>📊 {chartData.priceList.length.toLocaleString()} BARS</span>
            <span className="text-neutral-400">({firstDateLabel} ➔ NOW)</span>
          </div>

          {isLoadingHistory && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[10px] animate-pulse">
              <span>⏳ FETCHING GENESIS BARS...</span>
            </div>
          )}

          {onLoadEarlierHistory && (
            <button
              onClick={onLoadEarlierHistory}
              disabled={isLoadingHistory}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#131722] hover:bg-[#2a2e39] border border-[#2a2e39] text-[10px] text-sky-300 hover:text-white font-mono transition-colors font-bold disabled:opacity-50"
              title="Fetch older historical bars towards crypto market inception"
            >
              <span>➕ LOAD OLDER BARS</span>
            </button>
          )}

          {/* Active Price vs Pressure Divergence Pill in Legend */}
          {divergences && divergences.length > 0 && divergences[0].category === 'PRICE_VS_PRESSURE' && (
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-wider animate-pulse ${
                divergences[0].direction === 'BULLISH'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/50'
              }`}
            >
              <span>⚡ DIVERGENCE ACTIVE:</span>
              <span>
                PRICE {divergences[0].price2 >= divergences[0].price1 ? 'HH' : 'LL'} vs PRESSURE{' '}
                {divergences[0].indicator2 >= divergences[0].indicator1 ? 'HL' : 'LH'}
              </span>
            </div>
          )}
        </div>

        {/* Floating Price Controls */}
        <div className="absolute top-2 right-[85px] z-30 flex items-center gap-1.5 bg-[#1e222d]/90 p-1 rounded border border-[#2a2e39] shadow-md backdrop-blur-md">
          {/* Quick Macro Horizon Jumper */}
          <div className="hidden lg:flex items-center bg-[#131722] p-0.5 rounded border border-[#2a2e39] text-[10px] font-mono">
            <button
              onClick={() => jumpRange('ALL')}
              className="px-1.5 py-0.5 hover:bg-[#2a2e39] text-sky-400 font-bold rounded transition-colors"
              title={`View Complete Crypto Inception to Present (${firstDateLabel} - Present)`}
            >
              ALL ({firstDateLabel}-NOW)
            </button>
            <button
              onClick={() => jumpRange('5Y')}
              className="px-1.5 py-0.5 hover:bg-[#2a2e39] text-neutral-300 rounded transition-colors"
              title="View 5-Year Horizon"
            >
              5Y
            </button>
            <button
              onClick={() => jumpRange('1Y')}
              className="px-1.5 py-0.5 hover:bg-[#2a2e39] text-neutral-300 rounded transition-colors"
              title="View 1-Year Horizon"
            >
              1Y
            </button>
            <button
              onClick={() => jumpRange('YTD')}
              className="px-1.5 py-0.5 hover:bg-[#2a2e39] text-neutral-300 rounded transition-colors"
              title="View Year-to-Date"
            >
              YTD
            </button>
            <button
              onClick={() => jumpRange('RECENT')}
              className="px-1.5 py-0.5 bg-sky-500/20 text-sky-300 font-bold rounded transition-colors"
              title="Zoom to Recent Bars"
            >
              RECENT
            </button>
          </div>

          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5 hidden lg:block" />

          <button
            onClick={() => zoomChart(priceChartRef.current, 0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white transition-colors"
            title="Zoom In (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => zoomChart(priceChartRef.current, -0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white transition-colors"
            title="Zoom Out (-)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => resetChart(priceChartRef.current)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white transition-colors"
            title="Reset View / Auto-Fit All Bars"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5" />
          <button
            onClick={() => toggleMaximize('PRICE')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors font-bold ${
              maximizedChart === 'PRICE'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'bg-[#131722] hover:bg-[#2a2e39] text-neutral-300'
            }`}
            title="Maximize Price Chart to Full Screen"
          >
            {maximizedChart === 'PRICE' ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{maximizedChart === 'PRICE' ? 'RESTORE EQUAL' : 'FULL SCREEN'}</span>
          </button>
        </div>

        <div ref={priceContainerRef} className="w-full h-full flex-1" />

        {/* Synchronized Visual Divergence Trendlines on Price Chart */}
        {toggles.divergenceRadar && divergenceOverlay.priceLines.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible">
            {divergenceOverlay.timeSyncLines.map((t, idx) => (
              <g key={`sync_p_${idx}`}>
                <line x1={t.x1} y1={0} x2={t.x1} y2="100%" stroke={t.isBull ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)'} strokeWidth={1.5} strokeDasharray="4 4" />
                <line x1={t.x2} y1={0} x2={t.x2} y2="100%" stroke={t.isBull ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)'} strokeWidth={1.5} strokeDasharray="4 4" />
              </g>
            ))}
            {divergenceOverlay.priceLines.map((line, idx) => (
              <g key={`p_div_${idx}`}>
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={line.isBull ? '#089981' : '#f23645'}
                  strokeWidth={3}
                  strokeDasharray="6 3"
                />
                <circle cx={line.x1} cy={line.y1} r={4.5} fill={line.isBull ? '#089981' : '#f23645'} stroke="#fff" strokeWidth={1.5} />
                <circle cx={line.x2} cy={line.y2} r={5} fill={line.isBull ? '#089981' : '#f23645'} stroke="#fff" strokeWidth={1.5} />
                <foreignObject
                  x={(line.x1 + line.x2) / 2 - 110}
                  y={Math.min(line.y1, line.y2) - 34}
                  width={220}
                  height={34}
                  className="overflow-visible pointer-events-none"
                >
                  <div
                    className={`flex flex-col items-center justify-center px-2 py-0.5 rounded border text-[9px] font-mono font-bold shadow-xl backdrop-blur-md ${
                      line.isBull
                        ? 'bg-[#061814]/90 border-[#089981]/80 text-[#089981]'
                        : 'bg-[#18080a]/90 border-[#f23645]/80 text-[#f23645]'
                    }`}
                  >
                    <span className="uppercase tracking-wider">{line.label}</span>
                    <span className="text-neutral-400 text-[8px]">{line.subLabel}</span>
                  </div>
                </foreignObject>
              </g>
            ))}
          </svg>
        )}

        {/* 3D WebGL Gravitational Field & POI Absorption Shockwaves */}
        {(toggles.gravitational3D || toggles.poiAbsorption3D) && (
          <ThreeGravitationalCanvas
            liquidityWalls={liquidityWalls}
            activePOIs={activePOIs}
            currentPrice={currentPrice}
            minPrice={currentPrice * 0.98}
            maxPrice={currentPrice * 1.02}
            width={priceDimensions.width}
            height={priceDimensions.height}
            showGravitational={toggles.gravitational3D}
            showAbsorption={toggles.poiAbsorption3D}
          />
        )}
      </div>

      {/* 2. Cumulative Price Pressure Candlestick Chart */}
      <div
        className={`relative w-full flex-1 min-h-0 ${showPressure ? 'flex flex-col' : 'hidden'} ${
          showCVD || showOI ? 'border-b border-[#2a2e39]' : ''
        }`}
      >
        <div className="absolute top-2 left-3 z-20 flex flex-wrap items-center gap-2 text-xs font-mono pointer-events-none text-neutral-400 bg-[#1e222d]/90 px-2.5 py-1 rounded border border-[#2a2e39] shadow-sm backdrop-blur-md">
          <span className="font-bold text-sky-400">CUMULATIVE PRICE PRESSURE (CPP)</span>
          <span className="text-neutral-500">|</span>
          <span className="text-neutral-300">
            NET:{' '}
            <strong
              className={
                (chartData.lastCandle?.pressureClose || 0) >= (chartData.lastCandle?.pressureOpen || 0)
                  ? 'text-[#089981] font-bold'
                  : 'text-[#f23645] font-bold'
              }
            >
              {(chartData.lastCandle?.pressureClose || 0).toFixed(1)} CPP
            </strong>
          </span>

          {/* Divergence alert tag in Pressure Chart header */}
          {divergences && divergences.length > 0 && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide border uppercase animate-pulse ${
                divergences[0].direction === 'BULLISH'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
              }`}
            >
              ⚡ {divergences[0].title}
            </span>
          )}
        </div>

        <div className="absolute top-2 right-[85px] z-20 flex items-center gap-1 bg-[#1e222d]/90 p-1 rounded border border-[#2a2e39] shadow-md">
          {onOpenGuide && (
            <button
              onClick={() => onOpenGuide('PRESSURE')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-300 hover:bg-[#2a2e39] transition-colors"
              title="Learn how to trade using Price Pressure"
            >
              <HelpCircle className="w-3 h-3 text-amber-400" />
              <span className="hidden sm:inline">GUIDE</span>
            </button>
          )}
          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5" />
          <button
            onClick={() => zoomChart(pressureChartRef.current, 0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="Pressure Zoom In (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => zoomChart(pressureChartRef.current, -0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="Pressure Zoom Out (-)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => resetChart(pressureChartRef.current)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="Pressure Auto-Fit"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5" />
          <button
            onClick={() => toggleMaximize('PRESSURE')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors font-bold ${
              maximizedChart === 'PRESSURE'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'bg-[#131722] hover:bg-[#2a2e39] text-neutral-300'
            }`}
            title="Toggle Pressure Chart Full Screen"
          >
            {maximizedChart === 'PRESSURE' ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{maximizedChart === 'PRESSURE' ? 'RESTORE EQUAL' : 'FULL SCREEN'}</span>
          </button>
        </div>

        <div ref={pressureContainerRef} className="w-full h-full flex-1" />

        {/* Synchronized Visual Divergence Trendlines on Pressure Chart */}
        {toggles.divergenceRadar && divergenceOverlay.pressureLines.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible">
            {divergenceOverlay.timeSyncLines.map((t, idx) => (
              <g key={`sync_pr_${idx}`}>
                <line x1={t.x1} y1={0} x2={t.x1} y2="100%" stroke={t.isBull ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)'} strokeWidth={1.5} strokeDasharray="4 4" />
                <line x1={t.x2} y1={0} x2={t.x2} y2="100%" stroke={t.isBull ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)'} strokeWidth={1.5} strokeDasharray="4 4" />
              </g>
            ))}
            {divergenceOverlay.pressureLines.map((line, idx) => (
              <g key={`pr_div_${idx}`}>
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={line.isBull ? '#089981' : '#f23645'}
                  strokeWidth={3}
                  strokeDasharray="6 3"
                />
                <circle cx={line.x1} cy={line.y1} r={4.5} fill={line.isBull ? '#089981' : '#f23645'} stroke="#fff" strokeWidth={1.5} />
                <circle cx={line.x2} cy={line.y2} r={5} fill={line.isBull ? '#089981' : '#f23645'} stroke="#fff" strokeWidth={1.5} />
                <foreignObject
                  x={(line.x1 + line.x2) / 2 - 120}
                  y={Math.min(line.y1, line.y2) - 34}
                  width={240}
                  height={34}
                  className="overflow-visible pointer-events-none"
                >
                  <div
                    className={`flex flex-col items-center justify-center px-2 py-0.5 rounded border text-[9px] font-mono font-bold shadow-xl backdrop-blur-md ${
                      line.isBull
                        ? 'bg-[#061814]/90 border-[#089981]/80 text-[#089981]'
                        : 'bg-[#18080a]/90 border-[#f23645]/80 text-[#f23645]'
                    }`}
                  >
                    <span className="uppercase tracking-wider">{line.label}</span>
                    <span className="text-neutral-400 text-[8px]">{line.subLabel}</span>
                  </div>
                </foreignObject>
              </g>
            ))}
          </svg>
        )}
      </div>

      {/* 3. Cumulative Sub-Bar Directional Balance (CVD) Candlestick Chart */}
      <div
        className={`relative w-full flex-1 min-h-0 ${showCVD ? 'flex flex-col' : 'hidden'} ${
          showOI ? 'border-b border-[#2a2e39]' : ''
        }`}
      >
        <div className="absolute top-2 left-3 z-20 flex flex-wrap items-center gap-2 text-xs font-mono pointer-events-none text-neutral-400 bg-[#1e222d]/90 px-2.5 py-1 rounded border border-[#2a2e39] shadow-sm backdrop-blur-md">
          <span className="font-bold text-sky-400">CVD & SUB-BAR DELTA BALANCE</span>
          <span className="text-neutral-500">|</span>
          <span className="text-neutral-300">
            NET CVD:{' '}
            <strong
              className={
                (chartData.lastCandle?.cvdClose || 0) >= (chartData.lastCandle?.cvdOpen || 0)
                  ? 'text-[#089981] font-bold'
                  : 'text-[#f23645] font-bold'
              }
            >
              {(chartData.lastCandle?.cvdClose || 0).toFixed(0)} Δ
            </strong>
          </span>

          {/* Iceberg Wall Divergence Tag in CVD header */}
          {divergences && divergences.some((d) => d.category === 'PRESSURE_VS_CVD') && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide border uppercase animate-pulse ${
                divergences.find((d) => d.category === 'PRESSURE_VS_CVD')?.direction === 'BULLISH'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
              }`}
            >
              🧊 {divergences.find((d) => d.category === 'PRESSURE_VS_CVD')?.title}
            </span>
          )}
        </div>

        <div className="absolute top-2 right-[85px] z-20 flex items-center gap-1 bg-[#1e222d]/90 p-1 rounded border border-[#2a2e39] shadow-md">
          {onOpenGuide && (
            <button
              onClick={() => onOpenGuide('CVD')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-300 hover:bg-[#2a2e39] transition-colors"
              title="Learn how to trade CVD divergences & absorption"
            >
              <HelpCircle className="w-3 h-3 text-amber-400" />
              <span className="hidden sm:inline">GUIDE</span>
            </button>
          )}
          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5" />
          <button
            onClick={() => zoomChart(cvdChartRef.current, 0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="CVD Zoom In (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => zoomChart(cvdChartRef.current, -0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="CVD Zoom Out (-)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => resetChart(cvdChartRef.current)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="CVD Auto-Fit"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5" />
          <button
            onClick={() => toggleMaximize('CVD')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors font-bold ${
              maximizedChart === 'CVD'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'bg-[#131722] hover:bg-[#2a2e39] text-neutral-300'
            }`}
            title="Toggle CVD Chart Full Screen"
          >
            {maximizedChart === 'CVD' ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{maximizedChart === 'CVD' ? 'RESTORE EQUAL' : 'FULL SCREEN'}</span>
          </button>
        </div>

        <div ref={cvdContainerRef} className="w-full h-full flex-1" />

        {/* Synchronized Visual Divergence Trendlines on CVD Chart */}
        {toggles.divergenceRadar && divergenceOverlay.cvdLines.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible">
            {divergenceOverlay.timeSyncLines.map((t, idx) => (
              <g key={`sync_cvd_${idx}`}>
                <line x1={t.x1} y1={0} x2={t.x1} y2="100%" stroke={t.isBull ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)'} strokeWidth={1.5} strokeDasharray="4 4" />
                <line x1={t.x2} y1={0} x2={t.x2} y2="100%" stroke={t.isBull ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)'} strokeWidth={1.5} strokeDasharray="4 4" />
              </g>
            ))}
            {divergenceOverlay.cvdLines.map((line, idx) => (
              <g key={`c_div_${idx}`}>
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={line.isBull ? '#089981' : '#f23645'}
                  strokeWidth={3}
                  strokeDasharray="6 3"
                />
                <circle cx={line.x1} cy={line.y1} r={4.5} fill={line.isBull ? '#089981' : '#f23645'} stroke="#fff" strokeWidth={1.5} />
                <circle cx={line.x2} cy={line.y2} r={5} fill={line.isBull ? '#089981' : '#f23645'} stroke="#fff" strokeWidth={1.5} />
                <foreignObject
                  x={(line.x1 + line.x2) / 2 - 120}
                  y={Math.min(line.y1, line.y2) - 34}
                  width={240}
                  height={34}
                  className="overflow-visible pointer-events-none"
                >
                  <div
                    className={`flex flex-col items-center justify-center px-2 py-0.5 rounded border text-[9px] font-mono font-bold shadow-xl backdrop-blur-md ${
                      line.isBull
                        ? 'bg-[#061814]/90 border-[#089981]/80 text-[#089981]'
                        : 'bg-[#18080a]/90 border-[#f23645]/80 text-[#f23645]'
                    }`}
                  >
                    <span className="uppercase tracking-wider">{line.label}</span>
                    <span className="text-neutral-400 text-[8px]">{line.subLabel}</span>
                  </div>
                </foreignObject>
              </g>
            ))}
          </svg>
        )}
      </div>

      {/* 4. Open Interest (OI) & Funding Rate Candlestick Chart */}
      <div className={`relative w-full flex-1 min-h-0 ${showOI ? 'flex flex-col' : 'hidden'}`}>
        <div className="absolute top-2 left-3 z-20 flex items-center gap-2 text-xs font-mono pointer-events-none text-neutral-400 bg-[#1e222d]/90 px-2.5 py-1 rounded border border-[#2a2e39] shadow-sm">
          <span className="font-bold text-sky-400">OPEN INTEREST (OI)</span>
          <span className="text-neutral-500">|</span>
          <span>
            OI:{' '}
            <span
              className={
                (chartData.lastCandle?.oiClose || 0) >= (chartData.lastCandle?.oiOpen || 0)
                  ? 'text-[#089981] font-bold'
                  : 'text-[#f23645] font-bold'
              }
            >
              ${((chartData.lastCandle?.oiClose || 0) / 1000000).toFixed(2)}M
            </span>
          </span>
          <span className="text-neutral-500">·</span>
          <span>
            FUNDING:{' '}
            <span className="text-emerald-400">
              +{(((chartData.lastCandle?.fundingRate || 0.0001) * 100)).toFixed(4)}%
            </span>
          </span>
        </div>

        <div className="absolute top-2 right-[85px] z-20 flex items-center gap-1 bg-[#1e222d]/90 p-1 rounded border border-[#2a2e39] shadow-md">
          {onOpenGuide && (
            <button
              onClick={() => onOpenGuide('OI')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-300 hover:bg-[#2a2e39] transition-colors"
              title="Learn how to trade using Open Interest"
            >
              <HelpCircle className="w-3 h-3 text-amber-400" />
              <span className="hidden sm:inline">GUIDE</span>
            </button>
          )}
          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5" />
          <button
            onClick={() => zoomChart(oiChartRef.current, 0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="OI Zoom In (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => zoomChart(oiChartRef.current, -0.15)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="OI Zoom Out (-)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => resetChart(oiChartRef.current)}
            className="p-1 hover:bg-[#2a2e39] rounded text-neutral-300 hover:text-white"
            title="OI Auto-Fit"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-3.5 bg-[#2a2e39] mx-0.5" />
          <button
            onClick={() => toggleMaximize('OI')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors font-bold ${
              maximizedChart === 'OI'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'bg-[#131722] hover:bg-[#2a2e39] text-neutral-300'
            }`}
            title="Toggle OI Chart Full Screen"
          >
            {maximizedChart === 'OI' ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{maximizedChart === 'OI' ? 'RESTORE EQUAL' : 'FULL SCREEN'}</span>
          </button>
        </div>

        <div ref={oiContainerRef} className="w-full h-full flex-1" />
      </div>
    </div>
  );
};
