"use client";

import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useTheme } from "@/lib/theme";
import { fmtRupiahShort } from "@/lib/format";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

export interface RevenueSeriesPoint {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** Nilai kontrak lelang yang dimenangkan (Halte BRT) pada hari itu. */
  bidIdr: number;
  /** Nilai langganan Non-BRT aktif yang dibuat pada hari itu. */
  subIdr: number;
}

interface Props {
  series: RevenueSeriesPoint[];
}

export default function RevenueChart({ series }: Props) {
  const theme = useTheme();
  const isDark = theme === "dark";

  // Same palette tokens TrendChart uses, kept verbatim so chrome stays
  // consistent between the sponsor dashboard and the superadmin one.
  const bidColor    = isDark ? "#5A8AB8" : "#1E3A5F";
  const bidFill     = isDark ? "rgba(90,138,184,0.16)" : "rgba(30,58,95,0.10)";
  const subColor    = isDark ? "#4FB07A" : "#1F6B3A";
  const subFill     = isDark ? "rgba(79,176,122,0.14)" : "rgba(31,107,58,0.10)";
  const tooltipBg   = isDark ? "#2C5F7A" : "#0F2540";
  const gridColor   = isDark ? "rgba(255,255,255,0.08)" : "#EBE6DB";
  const tickColor   = isDark ? "#A8A39A" : "#8B847A";
  const legendColor = isDark ? "#D8D4CB" : "#4F4B45";
  const pointBg     = isDark ? "#1A1D27" : "#FFFFFF";

  const labels = series.map((p) => {
    const d = new Date(p.date);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  });

  const data = {
    labels,
    datasets: [
      {
        label: "Kontrak lelang (dimenangkan)",
        data: series.map((p) => p.bidIdr),
        borderColor: bidColor,
        backgroundColor: bidFill,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: bidColor,
        pointHoverBorderColor: pointBg,
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.35,
      },
      {
        label: "Langganan Non-BRT",
        data: series.map((p) => p.subIdr),
        borderColor: subColor,
        backgroundColor: subFill,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: subColor,
        pointHoverBorderColor: pointBg,
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.35,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        display: true,
        position: "top" as const,
        align: "end" as const,
        labels: {
          color: legendColor,
          font: { family: "Inter", size: 12 },
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          pointStyle: "circle" as const,
        },
      },
      tooltip: {
        backgroundColor: tooltipBg,
        titleFont: { family: "Inter", size: 12, weight: 600 as const },
        bodyFont: { family: "Inter", size: 12 },
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
            ` ${ctx.dataset.label}: ${fmtRupiahShort(Number(ctx.raw))}`,
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
          maxTicksLimit: 6,
          callback: (v: string | number) => fmtRupiahShort(Number(v)),
        },
        beginAtZero: true,
      },
    },
  } as const;

  // Semua nilai nol → tampilkan keterangan jujur, bukan grafik datar dengan
  // sumbu "Rp 0 / Rp 1" yang membingungkan.
  const isEmpty = series.length === 0 || series.every((p) => !p.bidIdr && !p.subIdr);
  if (isEmpty) {
    return (
      <div className="sa-dash-chart-container sa-dash-chart-empty">
        <p>Belum ada kontrak lelang atau langganan baru pada periode ini.</p>
      </div>
    );
  }

  return (
    <div className="sa-dash-chart-container">
      <Line data={data} options={options} />
    </div>
  );
}
