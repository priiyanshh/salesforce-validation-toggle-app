import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const buildApiUrl = (path) => `${API_BASE_URL}${path}`;

function App() {
  const [connected, setConnected] = useState(false);
  const [rules, setRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  const [toasts, setToasts] = useState([]);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const connectedClass = useMemo(
    () =>
      connected
        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
        : "bg-amber-100 text-amber-800 border-amber-200",
    [connected]
  );

  async function fetchAuthStatus() {
    try {
      const response = await fetch(buildApiUrl("/auth/status"), {
        credentials: "include",
      });
      const data = await response.json();
      setConnected(Boolean(data.connected));
      return Boolean(data.connected);
    } catch {
      setConnected(false);
      return false;
    }
  }

  async function fetchRules() {
    setLoadingRules(true);
    setError("");

    try {
      const response = await fetch(buildApiUrl("/api/validation-rules"), {
        credentials: "include",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load validation rules.");
      }

      setRules(data.records || []);
      setPendingChanges({});
    } catch (err) {
      setError(err.message);
      setRules([]);
    } finally {
      setLoadingRules(false);
    }
  }

  function addToast(type, message) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4500);
  }

  function handleToggle(ruleId, nextState) {
    setError("");
    setInfo("");
    setRules((prev) =>
      prev.map((rule) => (rule.Id === ruleId ? { ...rule, Active: nextState } : rule))
    );
    setPendingChanges((prev) => ({ ...prev, [ruleId]: nextState }));
  }

  async function handleLogin() {
    setIsLoggingIn(true);
    try {
      const health = await fetch(buildApiUrl("/health"), { credentials: "include" });
      if (!health.ok) {
        throw new Error("Backend is not reachable.");
      }

      const loginResponse = await fetch(buildApiUrl("/auth/login-url"), {
        credentials: "include",
      });
      const loginData = await loginResponse.json();

      if (!loginResponse.ok || !loginData.authUrl) {
        throw new Error(loginData.error || "Failed to initialize Salesforce OAuth.");
      }

      window.location.assign(loginData.authUrl);
    } catch (err) {
      addToast(
        "error",
        "Cannot start Salesforce login. Ensure backend is running and Connected App credentials are valid."
      );
      setError(err.message || "Backend unavailable.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleDeploy() {
    setError("");
    setInfo("");
    const changes = Object.entries(pendingChanges).map(([ruleId, active]) => ({
      ruleId,
      active,
    }));

    if (changes.length === 0) {
      addToast("info", "No changes to deploy.");
      return;
    }

    try {
      setIsDeploying(true);
      const response = await fetch(buildApiUrl("/api/deploy"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ changes }),
      });
      const data = await response.json();
      if (!response.ok && response.status !== 207) {
        throw new Error(data.error || "Deploy check failed.");
      }

      const failed = data.results?.filter((item) => !item.success) || [];
      if (failed.length > 0) {
        failed.forEach((item) => {
          addToast(
            "error",
            `Rule ${item.ruleId}: ${item.error || "Salesforce update failed."}`
          );
        });
        setError(data.message || "Some metadata updates failed.");
      } else {
        setInfo(data.message || "Deploy confirmed.");
      }

      const successful = data.results?.filter((item) => item.success) || [];
      if (successful.length > 0) {
        setPendingChanges((prev) => {
          const next = { ...prev };
          successful.forEach((item) => {
            delete next[item.ruleId];
          });
          return next;
        });
      }
    } catch (err) {
      setError(err.message);
      addToast("error", err.message);
    } finally {
      setIsDeploying(false);
    }
  }

  useEffect(() => {
    const sync = async () => {
      const isConnected = await fetchAuthStatus();
      if (isConnected) {
        fetchRules();
      }
    };
    sync();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Salesforce Validation Rule Manager
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Manage Account validation rule activation states from one
                dashboard.
              </p>
            </div>
            <div
              className={`rounded-full border px-4 py-2 text-sm font-medium ${connectedClass}`}
            >
              {connected
                ? "Connected to Salesforce"
                : "Not connected to Salesforce"}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            {!connected ? (
              <button
                type="button"
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoggingIn ? "Connecting..." : "Login to Salesforce"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={fetchRules}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Refresh Rules
                </button>
                <button
                  type="button"
                  onClick={handleDeploy}
                  disabled={isDeploying}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeploying ? "Deploying..." : "Deploy"}
                </button>
              </>
            )}
          </div>

          {info && (
            <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {info}
            </p>
          )}
          {error && (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}
        </header>

        <section className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-medium text-slate-900">
              Account Validation Rules
            </h2>
          </div>

          {!connected ? (
            <div className="px-6 py-8 text-sm text-slate-600">
              Connect to Salesforce to load Account validation rules.
            </div>
          ) : loadingRules ? (
            <div className="px-6 py-8 text-sm text-slate-600">
              Loading validation rules...
            </div>
          ) : rules.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-600">
              No validation rules were returned for Account.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Rule Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Error Message
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Active
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Toggle
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rules.map((rule) => {
                  const nextState = !rule.Active;
                  const hasPending = Object.hasOwn(pendingChanges, rule.Id);

                  return (
                    <tr key={rule.Id}>
                      <td className="px-6 py-4 text-sm font-medium text-slate-800">
                        {rule.Name}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {rule.ErrorMessage}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            rule.Active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {rule.Active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          disabled={isDeploying}
                          onClick={() => handleToggle(rule.Id, nextState)}
                          className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
                            rule.Active ? "bg-emerald-500" : "bg-slate-400"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                          aria-label={`Toggle ${rule.Name}`}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                              rule.Active ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                        {hasPending && (
                          <p className="mt-1 text-xs text-amber-600">Pending deploy</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="pointer-events-none fixed right-6 top-6 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-md ${
              toast.type === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
