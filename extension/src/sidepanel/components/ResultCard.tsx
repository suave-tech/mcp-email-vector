import { buildDeeplink } from "../../lib/deeplinks";
import type { SearchHit } from "../../lib/api";

interface Props {
  hit: SearchHit;
}

const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail",
  yahoo: "Yahoo",
};

export function ResultCard({ hit }: Props) {
  const { metadata } = hit;
  const deeplink = buildDeeplink(metadata.provider, metadata.message_id, metadata.subject);
  const date = metadata.date
    ? new Date(metadata.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const from = metadata.sender_name
    ? `${metadata.sender_name} <${metadata.sender_email}>`
    : metadata.sender_email;

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-1 text-sm font-semibold text-gray-900">
          {metadata.subject || "(no subject)"}
        </p>
        <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
          {PROVIDER_LABEL[metadata.provider] ?? metadata.provider}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        {from}{date ? ` · ${date}` : ""}
      </p>
      {deeplink && (
        <a
          href={deeplink}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline"
        >
          Open in {PROVIDER_LABEL[metadata.provider] ?? "mail"} →
        </a>
      )}
    </div>
  );
}
