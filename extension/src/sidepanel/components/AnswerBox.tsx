interface Props {
  answer: string;
}

// Minimal markdown bold renderer — converts **text** to <strong>text</strong>.
// Keeps the component dependency-free (no remark/marked).
function renderMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>");
}

export function AnswerBox({ answer }: Props) {
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-gray-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-500">AI Answer</p>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: controlled markdown subset */}
      <p dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }} />
    </div>
  );
}
