'use client';

import React, { useState } from 'react';
import { DivergenceSignal, DivergenceCategory } from '@/types/orderflow';
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Layers,
  Activity,
  ArrowRight,
  ShieldAlert,
  Zap,
} from 'lucide-react';

interface DivergenceVisualizerHUDProps {
  divergences: DivergenceSignal[];
  onSelectDivergence?: (signal: DivergenceSignal) => void;
}

export const DivergenceVisualizerHUD: React.FC<DivergenceVisualizerHUDProps> = ({
  divergences,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [filterCategory, setFilterCategory] = useState<'ALL' | DivergenceCategory>('ALL');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  if (!divergences || divergences.length === 0) return null;

  const filteredDivergences =
    filterCategory === 'ALL'
      ? divergences
      : divergences.filter((d) => d.category === filterCategory);

  const activeList = filteredDivergences.length > 0 ? filteredDivergences : divergences;
  const currentSignal = activeList[Math.min(selectedIndex, activeList.length - 1)] || activeList[0];
  const isBull = currentSignal.direction === 'BULLISH';
  const isPriceVsPress = currentSignal.category === 'PRICE_VS_PRESSURE';

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 max-w-2xl w-[94%] sm:w-auto animate-in slide-in-from-top duration-300 pointer-events-auto">
      <div
        className={`rounded-xl border shadow-2xl backdrop-blur-xl transition-all duration-300 overflow-hidden ${
          isBull
            ? 'bg-[#061814]/95 border-[#089981]/70 shadow-[0_0_25px_rgba(8,153,129,0.3)]'
            : 'bg-[#18080a]/95 border-[#f23645]/70 shadow-[0_0_25px_rgba(242,54,69,0.3)]'
        }`}
      >
        {/* Top Header Bar */}
        <div className="flex flex-wrap items-center justify-between px-3.5 py-2 gap-2.5 bg-black/30 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span
              className={`p-1.5 rounded-lg shadow-sm ${
                isBull ? 'bg-[#089981]/25 text-[#089981]' : 'bg-[#f23645]/25 text-[#f23645]'
              }`}
            >
              {isBull ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 font-mono">
                <span className="text-[12px] font-black uppercase tracking-wider text-white">
                  {currentSignal.title}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide uppercase ${
                    isBull ? 'bg-[#089981] text-neutral-950' : 'bg-[#f23645] text-white'
                  }`}
                >
                  {currentSignal.direction} ({currentSignal.confidence}%)
                </span>
              </div>
              <span className="text-[10px] font-mono text-neutral-400">
                {isPriceVsPress ? '⚡ PRICE vs PRICE PRESSURE DIVERGENCE' : '🧊 PRICE PRESSURE vs CVD (ICEBERG WALL)'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Category Filter Pills */}
            <div className="hidden sm:flex items-center gap-1 p-0.5 bg-black/40 rounded-lg border border-white/10 text-[10px] font-mono">
              <button
                onClick={() => {
                  setFilterCategory('ALL');
                  setSelectedIndex(0);
                }}
                className={`px-2 py-0.5 rounded transition-all ${
                  filterCategory === 'ALL'
                    ? 'bg-white/20 text-white font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                ALL ({divergences.length})
              </button>
              <button
                onClick={() => {
                  setFilterCategory('PRICE_VS_PRESSURE');
                  setSelectedIndex(0);
                }}
                className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
                  filterCategory === 'PRICE_VS_PRESSURE'
                    ? 'bg-sky-500/30 text-sky-300 font-bold border border-sky-400/40'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Activity className="w-2.5 h-2.5" />
                PRICE / PRESSURE
              </button>
              <button
                onClick={() => {
                  setFilterCategory('PRESSURE_VS_CVD');
                  setSelectedIndex(0);
                }}
                className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
                  filterCategory === 'PRESSURE_VS_CVD'
                    ? 'bg-purple-500/30 text-purple-300 font-bold border border-purple-400/40'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Layers className="w-2.5 h-2.5" />
                PRESSURE / CVD
              </button>
            </div>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-white/10 rounded-lg text-neutral-300 transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand Details'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Detailed Divergence Breakdown & Side-by-Side Visual Comparison */}
        {isExpanded && (
          <div className="p-3.5 space-y-3 font-mono text-xs">
            {/* Side-by-side Divergence Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Primary Indicator Box (Price or CVD) */}
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/10 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                  <span className="font-bold flex items-center gap-1">
                    {isPriceVsPress ? <Activity className="w-3.5 h-3.5 text-sky-400" /> : <Layers className="w-3.5 h-3.5 text-purple-400" />}
                    {isPriceVsPress ? 'PRICE SWING TEST' : 'CVD (MARKET AGGRESSION)'}
                  </span>
                  <span
                    className={`font-black text-[10px] px-1.5 py-0.5 rounded ${
                      (currentSignal.price2 >= currentSignal.price1 && isPriceVsPress) ||
                      ((currentSignal.secondaryIndicator2 || 0) >= (currentSignal.secondaryIndicator1 || 0) && !isPriceVsPress)
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {isPriceVsPress
                      ? currentSignal.price2 >= currentSignal.price1
                        ? '↗ HIGHER HIGH (HH)'
                        : '↘ LOWER LOW (LL)'
                      : (currentSignal.secondaryIndicator2 || 0) >= (currentSignal.secondaryIndicator1 || 0)
                      ? '↗ CVD HIGHER HIGH (HH)'
                      : '↘ CVD LOWER LOW (LL)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-neutral-400">
                    Point 1:{' '}
                    <strong className="text-white">
                      {isPriceVsPress ? `$${currentSignal.price1.toFixed(1)}` : `${(currentSignal.secondaryIndicator1 || 0).toFixed(0)} Δ`}
                    </strong>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-500" />
                  <span className="text-neutral-400">
                    Point 2:{' '}
                    <strong className="text-white">
                      {isPriceVsPress ? `$${currentSignal.price2.toFixed(1)}` : `${(currentSignal.secondaryIndicator2 || 0).toFixed(0)} Δ`}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Price Pressure Box */}
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/10 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                  <span className="font-bold flex items-center gap-1 text-amber-300">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    CUMULATIVE PRICE PRESSURE
                  </span>
                  <span
                    className={`font-black text-[10px] px-1.5 py-0.5 rounded ${
                      currentSignal.indicator2 >= currentSignal.indicator1
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {currentSignal.indicator2 >= currentSignal.indicator1
                      ? '↗ HIGHER LOW (HL DEFENSE)'
                      : '↘ LOWER HIGH (LH EXHAUSTION)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-neutral-400">
                    P1: <strong className="text-white">{currentSignal.indicator1.toFixed(1)} CPP</strong>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-500" />
                  <span className="text-neutral-400">
                    P2: <strong className="text-white">{currentSignal.indicator2.toFixed(1)} CPP</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Explanation Narrative */}
            <p className="text-neutral-200 text-[11px] leading-relaxed bg-black/20 p-2.5 rounded-lg border border-white/5">
              {currentSignal.explanation}
            </p>

            {/* Institutional Action Plan & Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10 text-[11px]">
              <div className="flex items-center gap-1.5 text-neutral-300">
                <ShieldAlert className={`w-3.5 h-3.5 ${isBull ? 'text-[#089981]' : 'text-[#f23645]'}`} />
                <span>
                  INSTITUTIONAL PLAYBOOK:{' '}
                  <strong className={isBull ? 'text-[#089981]' : 'text-[#f23645]'}>
                    {currentSignal.action}
                  </strong>
                </span>
              </div>

              {/* Signal Switcher Buttons */}
              {activeList.length > 1 && (
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-neutral-400">Signals:</span>
                  {activeList.map((sig, idx) => (
                    <button
                      key={sig.id}
                      onClick={() => setSelectedIndex(idx)}
                      className={`w-5 h-5 rounded flex items-center justify-center font-bold transition-all ${
                        selectedIndex === idx
                          ? sig.direction === 'BULLISH'
                            ? 'bg-[#089981] text-black font-black'
                            : 'bg-[#f23645] text-white font-black'
                          : 'bg-white/10 hover:bg-white/20 text-neutral-300'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

