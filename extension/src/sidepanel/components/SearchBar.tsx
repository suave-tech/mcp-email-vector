import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
}

export function SearchBar({ value, onChange, loading }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="relative">
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search your email…"
        className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 pr-10 text-sm shadow-sm outline-none placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      )}
    </div>
  );
}
