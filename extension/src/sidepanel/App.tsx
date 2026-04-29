import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchHit } from "../lib/api";
import { search } from "../lib/api";
import { getConfig } from "../lib/storage";
import { AnswerBox } from "./components/AnswerBox";
import { EmptyState } from "./components/EmptyState";
import { ResultCard } from "./components/ResultCard";
import { SearchBar } from "./components/SearchBar";

export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getConfig().then(({ token }) => setConfigured(!!token));

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ("token" in changes) setConfigured(!!changes.token?.newValue);
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setHits([]);
      setAnswer(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await search(q);
      setHits(result.hits);
      setAnswer(result.answer ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setHits([]);
      setAnswer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 500);
  };

  if (configured === null) return null;

  if (!configured) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <p className="text-sm font-medium text-gray-700">Set up the extension first</p>
        <p className="mt-1 text-xs text-gray-400">Paste your API token in the extension settings.</p>
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Open settings →
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-100 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-gray-800">Email Search</h1>
      </header>
      <div className="px-4 pt-3">
        <SearchBar value={query} onChange={handleQueryChange} loading={loading} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-xs text-red-600">{error}</p>
        )}
        {!error && hits.length === 0 && <EmptyState query={query} />}
        {!error && hits.length > 0 && (
          <div className="flex flex-col gap-2">
            {answer && <AnswerBox answer={answer} />}
            {hits.map((hit) => (
              <ResultCard key={hit.metadata.message_id} hit={hit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
