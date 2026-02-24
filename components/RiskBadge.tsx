import React from 'react';
import { RiskAnalysis } from '../types';

interface Props { analysis: RiskAnalysis; }

export const RiskBadge: React.FC<Props> = ({ analysis }) => {
  const { level, score } = analysis;
  const cfg = {
    Low:    { bar: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: '低风险', ping: 'bg-emerald-400' },
    Medium: { bar: 'bg-amber-500',   text: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',     label: '中风险', ping: 'bg-amber-400' },
    High:   { bar: 'bg-rose-500',    text: 'text-rose-400',    bg: 'bg-rose-500/10 border-rose-500/20',       label: '高危预警', ping: 'bg-rose-400' },
  }[level];

  return (
    <div className={`p-3 rounded-xl border ${cfg.bg} space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.ping}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.bar}`}></span>
          </span>
          <span className={`text-xs font-bold uppercase tracking-wider ${cfg.text}`}>{cfg.label}</span>
        </div>
        <span className={`text-xs font-mono font-bold ${cfg.text}`}>申诉成功率 ~{Math.round(score)}%</span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-1.5">
        <div className={`${cfg.bar} h-1.5 rounded-full transition-all duration-700`} style={{ width: `${score}%` }}></div>
      </div>
      {analysis.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {analysis.reasons.map((r, i) => (
            <li key={i} className="text-[10px] text-slate-500">{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
