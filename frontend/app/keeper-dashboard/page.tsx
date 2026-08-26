'use client';

import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  PerformanceMetric,
  StatusDistribution,
  AnalyticsSummary,
} from '@/types/keeper-analytics.types';

const MOCK_PERFORMANCE_DATA: PerformanceMetric[] = [
  { date: 'Jul 18', earnedXlm: 120, gasSpentXlm: 18, netProfitXlm: 102, executions: 45 },
  { date: 'Jul 19', earnedXlm: 150, gasSpentXlm: 22, netProfitXlm: 128, executions: 58 },
  { date: 'Jul 20', earnedXlm: 90, gasSpentXlm: 14, netProfitXlm: 76, executions: 32 },
  { date: 'Jul 21', earnedXlm: 210, gasSpentXlm: 30, netProfitXlm: 180, executions: 82 },
  { date: 'Jul 22', earnedXlm: 180, gasSpentXlm: 25, netProfitXlm: 155, executions: 70 },
  { date: 'Jul 23', earnedXlm: 240, gasSpentXlm: 32, netProfitXlm: 208, executions: 95 },
  { date: 'Jul 24', earnedXlm: 280, gasSpentXlm: 38, netProfitXlm: 242, executions: 110 },
];

const MOCK_STATUS_DISTRIBUTION: StatusDistribution[] = [
  { name: 'Successful', value: 462, color: '#10B981' },
  { name: 'Reverted / Failed', value: 24, color: '#EF4444' },
  { name: 'Slippage Exceeded', value: 8, color: '#F59E0B' },
];

const MOCK_SUMMARY: AnalyticsSummary = {
  totalEarnedXlm: 1270,
  totalGasSpentXlm: 179,
  netProfitXlm: 1091,
  profitMarginPercent: 85.9,
  totalExecutions: 494,
  successRatePercent: 93.5,
};

export default function KeeperDashboardPage() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');

  const exportAsJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(MOCK_PERFORMANCE_DATA, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `keeper_analytics_${timeRange}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportAsCSV = () => {
    const headers = ['Date', 'Earned XLM', 'Gas Spent XLM', 'Net Profit XLM', 'Executions'];
    const rows = MOCK_PERFORMANCE_DATA.map((row) =>
      [row.date, row.earnedXlm, row.gasSpentXlm, row.netProfitXlm, row.executions].join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', encodedUri);
    downloadAnchor.setAttribute('download', `keeper_analytics_${timeRange}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-foreground">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keeper Performance Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Track execution profitability, gas expenditures, and operational success rates.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
            className="px-3 py-1.5 border rounded-md text-sm font-medium bg-background focus:ring-2 focus:ring-primary"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>

          <button
            onClick={exportAsCSV}
            className="px-3 py-1.5 text-xs font-semibold border rounded-md hover:bg-muted transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={exportAsJSON}
            className="px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Net Profit</p>
          <p className="text-2xl font-bold text-emerald-600 font-mono mt-1">
            +{MOCK_SUMMARY.netProfitXlm} XLM
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Margin: <span className="font-semibold text-emerald-600">{MOCK_SUMMARY.profitMarginPercent}%</span>
          </p>
        </div>

        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Total Revenue</p>
          <p className="text-2xl font-bold font-mono mt-1">{MOCK_SUMMARY.totalEarnedXlm} XLM</p>
          <p className="text-xs text-muted-foreground mt-1">Gas Spent: {MOCK_SUMMARY.totalGasSpentXlm} XLM</p>
        </div>

        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Total Executions</p>
          <p className="text-2xl font-bold font-mono mt-1">{MOCK_SUMMARY.totalExecutions}</p>
          <p className="text-xs text-muted-foreground mt-1">Automated Soroban tasks</p>
        </div>

        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Success Rate</p>
          <p className="text-2xl font-bold font-mono text-primary mt-1">
            {MOCK_SUMMARY.successRatePercent}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">Execution reliability</p>
        </div>
      </div>

      {/* Visualizations Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Earnings vs Gas Area Chart */}
        <div className="lg:col-span-2 p-6 border rounded-xl bg-card shadow-sm space-y-4">
          <h2 className="text-base font-semibold">Earnings & Gas Expenditure Trends</h2>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={MOCK_PERFORMANCE_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="earnedColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gasColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="earnedXlm" stroke="#10B981" fillOpacity={1} fill="url(#earnedColor)" name="Earned (XLM)" />
                <Area type="monotone" dataKey="gasSpentXlm" stroke="#EF4444" fillOpacity={1} fill="url(#gasColor)" name="Gas Spent (XLM)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Success vs Failure Breakdown */}
        <div className="p-6 border rounded-xl bg-card shadow-sm space-y-4">
          <h2 className="text-base font-semibold">Execution Status Breakdown</h2>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={MOCK_STATUS_DISTRIBUTION}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {MOCK_STATUS_DISTRIBUTION.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}