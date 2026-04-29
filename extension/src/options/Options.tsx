import { useEffect, useState } from "react";
import { whoAmI } from "../lib/api";
import { getConfig, setConfig } from "../lib/storage";

type VerifyState = "idle" | "loading" | "ok" | "error";

export function Options() {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig().then(({ apiUrl: u, token: t }) => {
      setApiUrl(u);
      setToken(t);
    });
  }, []);

  const handleVerify = async () => {
    setVerifyState("loading");
    setVerifiedEmail(null);
    setVerifyError(null);
    try {
      const me = await whoAmI(apiUrl, token);
      setVerifiedEmail(me.email ?? me.userId);
      setVerifyState("ok");
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed");
      setVerifyState("error");
    }
  };

  const handleSave = async () => {
    await setConfig({ apiUrl, token });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-6 text-lg font-semibold text-gray-900">Email Search — Settings</h1>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-5">
            <div>
              <label htmlFor="apiUrl" className="mb-1.5 block text-sm font-medium text-gray-700">
                API URL
              </label>
              <input
                id="apiUrl"
                type="url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                placeholder="http://localhost:3000"
              />
            </div>

            <div>
              <label htmlFor="token" className="mb-1.5 block text-sm font-medium text-gray-700">
                API Token
              </label>
              <textarea
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                placeholder="Paste the JWT from pnpm run create-user"
              />
              <p className="mt-1 text-xs text-gray-400">
                Run <code className="rounded bg-gray-100 px-1">pnpm run create-user</code> to generate a token.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleVerify}
                disabled={!token || verifyState === "loading"}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                {verifyState === "loading" ? "Verifying…" : "Verify token"}
              </button>

              {verifyState === "ok" && verifiedEmail && (
                <span className="text-sm text-green-600">✓ {verifiedEmail}</span>
              )}
              {verifyState === "error" && verifyError && (
                <span className="text-sm text-red-500">✗ {verifyError}</span>
              )}
            </div>
          </div>

          <div className="mt-6 border-t border-gray-100 pt-5">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {saved ? "Saved ✓" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
