// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { fmt, fmtShort, gen30d } from "@/data/dashboardData";
import { useTheme } from "@/lib/theme";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip
);

interface TrendChartProps {
  baseValue: number;
  unitLabel?: string;
}

export default function TrendChart({ baseValue, unitLabel = "impressi" }: TrendChartProps) {
  const theme = useTheme();
  const isDark = theme === "dark";

  // Theme-derived chart colors. Brand line uses the brighter mid-blue in
  // dark mode; grid + tick label use a low-opacity white instead of the
  // light-mode warm border. Tooltip surface mirrors the corresponding
  // brand-deep token for each theme.
  const lineColor       = isDark ? "#4A7AA8" : "#1E3A5F";
  const fillColor       = isDark ? "rgba(74,122,168,0.14)" : "rgba(30,58,95,0.08)";
  const pointBorderBg   = isDark ? "#1A1D27" : "#FFFFFF";
  const tooltipBg       = isDark ? "#2C5F7A" : "#0F2540";
  const gridColor       = isDark ? "rgba(255,255,255,0.08)" : "#EBE6DB";
  const tickColor       = isDark ? "#6B6760" : "#8B847A";

  const { labels, values } = useMemo(() => {
    const daily = gen30d(baseValue);
    return {
      labels: daily.map((d) => {
        const dt = new Date(d.date);
        return `${dt.getDate()}/${dt.getMonth() + 1}`;
      }),
      values: daily.map((d) => d.value),
    };
  }, [baseValue]);

  const data = {
    labels,
    datasets: [
      {
        label: "Total impressi",
        data: values,
        borderColor: lineColor,
        backgroundColor: fillColor,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: lineColor,
        pointHoverBorderColor: pointBorderBg,
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.35,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tooltipBg,
        titleFont: { family: "Inter", size: 12, weight: 600 as const },
        bodyFont: { family: "Inter", size: 12 },
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: (ctx: { raw: unknown }) => `${fmt(Number(ctx.raw))} ${unitLabel}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: "Inter", size: 10 },
          color: tickColor,
          maxRotation: 0,
          autoSkipPadding: 12,
        },
      },
      y: {
        grid: { color: gridColor },
        ticks: {
          font: { family: "Inter", size: 10 },
          color: tickColor,
          callback: (v: string | number) => fmtShort(Number(v)),
        },
        beginAtZero: true,
      },
    },
  } as const;

  return (
    <div className="dash-chart-container">
      <Line data={data} options={options} />
    </div>
  );
}
