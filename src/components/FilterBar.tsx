"use client";

// Tier chips (S–D) dihapus: tangga tier tidak ada di deck dan DB hanya
// mengenal premium/mass. Filter status juga tidak ditambahkan karena semua
// titik yang tampil sudah tersaring server (Halte BRT = lelang berjalan,
// Non-BRT = tersedia) — yang tersisa hanya pencarian nama.

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
}

export default function FilterBar({
  searchValue,
  onSearchChange,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <div className="filter-search-wrap">
        <svg
          className="filter-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="filter-search"
          placeholder="cari halte…"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Cari halte"
        />
      </div>
    </div>
  );
}
