interface Props {
  query: string;
}

export function EmptyState({ query }: Props) {
  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
        <svg className="mb-3 h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z"
          />
        </svg>
        <p className="text-sm">Type to search your email</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
      <p className="text-sm">No results for "{query}"</p>
      <p className="mt-1 text-xs">Try different keywords or a broader phrase</p>
    </div>
  );
}
