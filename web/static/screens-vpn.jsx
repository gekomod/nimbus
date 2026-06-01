// ===== VPN — WireGuard + OpenVPN + IPSec · instalator · konfigurator =====

const { useState, useEffect, useRef, useCallback } = React;

// ─── State meta ────────────────────────────────────────────────────────────────

const VPN_STATE_META = {
  online:  { label: "ONLINE",  color: "var(--ok)",     pulse: true },
  idle:    { label: "IDLE",    color: "var(--warn)",   pulse: false },
  offline: { label: "OFFLINE", color: "var(--fg-dim)", pulse: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const vpnApi = (path, opts = {}) =>
  fetch(path, { credentials: "include", ...opts }).then(r => r.json());

const vpnPost = (path, body) => vpnApi(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const vpnDelete = (path) => fetch(path, { method: "DELETE", credentials: "include" })
  .then(r => r.ok ? r.json().catch(() => ({})) : r.text().then(t => { throw new Error(t || r.status) }));
const vpnPatch  = (path, body) => vpnApi(path, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const fmtGB = v => {
  if (!v) return "0 MB";
  if (v < 0.001) return (v * 1024).toFixed(0) + " KB";
  if (v < 1)    return (v * 1024).toFixed(1) + " MB";
  return v.toFixed(2) + " GB";
};

// ─── Install Banner ───────────────────────────────────────────────────────────

const InstallBanner = ({ module, onInstalled }) => {
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const INFO = {
    wireguard: {
      name:     "WireGuard",
      emoji:    "🔐",
      desc:     "Nowoczesny, szybki i bezpieczny protokół VPN zintegrowany z jądrem Linux. Po instalacji automatycznie zostanie skonfigurowany interfejs wg0 i uruchomiona usługa.",
      packages: ["wireguard", "wireguard-tools", "qrencode"],
      endpoint: "/api/vpn/install-wireguard",
    },
    openvpn: {
      name:     "OpenVPN",
      emoji:    "🔒",
      desc:     "Klasyczny VPN SSL/TLS — kompatybilny z praktycznie każdym urządzeniem.",
      packages: ["openvpn", "easy-rsa"],
      endpoint: "/api/vpn/install-openvpn",
    },
    ipsec: {
      name:     "IPSec (strongSwan)",
      emoji:    "🛡",
      desc:     "IPSec/IKEv2 — natywne wsparcie w iOS, macOS i Windows bez dodatkowych klientów.",
      packages: ["strongswan", "strongswan-pki", "libcharon-extra-plugins"],
      endpoint: "/api/vpn/install-ipsec",
    },
  };

  const m = INFO[module] || INFO.wireguard;

  const runInstall = async () => {
    setInstalling(true); setErr("");
    setLog([`apt install ${m.packages.join(" ")}…`]);
    try {
      const r = await fetch(m.endpoint, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packages: m.packages }),
      });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        const lines = ["✓ Instalacja zakończona"];
        if (d.config)  lines.push("✓ " + d.config);
        if (d.warning) lines.push("⚠ " + d.warning);
        setLog(l => [...l, ...lines]);
        setDone(true);
        setTimeout(() => onInstalled && onInstalled(), 1200);
      } else {
        const t = await r.text().catch(() => "");
        setErr("Błąd: " + (t || r.status));
      }
    } catch (e) {
      setErr("Błąd: " + e.message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{m.emoji}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{m.name} nie jest zainstalowany</div>
      <div style={{ fontSize: 13, color: "var(--fg-dim)", maxWidth: 520, margin: "0 auto 24px", lineHeight: 1.6 }}>
        {m.desc}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 20 }}>
        {m.packages.map(p => (
          <span key={p} className="chip mono" style={{ fontSize: 13, padding: "4px 12px" }}>{p}</span>
        ))}
      </div>

      {log.length > 0 && (
        <div style={{ background: "var(--bg)", borderRadius: 7, padding: "10px 14px",
          fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.8,
          maxHeight: 120, overflowY: "auto", border: "1px solid var(--line)",
          textAlign: "left", maxWidth: 520, margin: "0 auto 16px" }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✓") ? "var(--ok)" : l.startsWith("⚠") ? "var(--warn)" : "var(--fg-dim)" }}>{l}</div>
          ))}
          {installing && <span style={{ color: "var(--accent)" }}>█</span>}
        </div>
      )}

      {err && <div style={{ color: "var(--err)", fontSize: 12, marginBottom: 12 }}>{err}</div>}

      {!done && (
        <button className="btn primary" style={{ padding: "10px 28px", fontSize: 13 }}
          disabled={installing} onClick={runInstall}>
          <Icon name="download" size={14}/> {installing ? "Instalowanie…" : `Zainstaluj ${m.name}`}
        </button>
      )}
      <div style={{ marginTop: 10, fontSize: 10, color: "var(--fg-dim)" }}>
        Wymaga uprawnień root · instalacja przez apt
      </div>
    </div>
  );
};

// ─── WireGuard Configurator (nowy interfejs) ──────────────────────────────────

const WgConfigurator = ({ onCreated }) => {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");
  const [genKeys, setGenKeys] = useState(null);
  const [result, setResult]   = useState(null);
  const [form, setForm] = useState({
    interface:   "wg0",
    address:     "10.8.0.1/24",
    listen_port: "51820",
    dns:         "1.1.1.1",
    mtu:         1420,
    endpoint:    "",
    nat_iface:   "eth0",
    autostart:   true,
  });

  const set = k => e => setForm(f => ({ ...f, [k]: typeof e === "string" ? e : e.target.value }));

  const generateKeys = async () => {
    setBusy(true); setErr("");
    try {
      const d = await vpnApi("/api/vpn/wireguard-keys/generate", { method: "POST", credentials: "include" });
      setGenKeys(d);
    } catch (e) { setErr("Błąd generowania kluczy: " + e.message); }
    setBusy(false);
  };

  const createInterface = async () => {
    if (!genKeys?.private_key) { setErr("Najpierw wygeneruj klucze"); return; }
    if (!form.address || !form.listen_port) { setErr("Adres i port są wymagane"); return; }
    setBusy(true); setErr("");
    try {
      const d = await vpnPost("/api/vpn/wireguard", {
        ...form,
        private_key: genKeys.private_key,
        mtu: +form.mtu,
      });
      if (d.status === "ok") {
        // Uruchom interfejs
        await vpnApi(`/api/vpn/wireguard/${form.interface}/start`, { method: "POST", credentials: "include" });
        // Włącz autostart
        if (form.autostart) {
          await vpnApi("/api/system/services/wg-quick@" + form.interface + "/enable", { method: "POST", credentials: "include" }).catch(() => {});
        }
        setResult(d);
        setStep(4);
        onCreated && onCreated();
      } else {
        setErr(d.error || "Błąd tworzenia interfejsu");
      }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const inp = (label, key, ph, type = "text", hint = "") => (
    <div>
      <label style={{ fontSize: 10, color: "var(--fg-dim)", display: "block", marginBottom: 3,
        letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</label>
      <input className="input" type={type} value={form[key]} onChange={set(key)} placeholder={ph}
        style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)",
          border: "1px solid var(--line)", padding: "7px 9px", borderRadius: 5, color: "var(--fg)" }}/>
      {hint && <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 3 }}>{hint}</div>}
    </div>
  );

  const steps = ["Konfiguracja sieci", "Klucze kryptograficzne", "Zaawansowane", "Gotowe"];

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "8px 0" }}>
      {/* Stepper */}
      <div style={{ display: "flex", gap: 0, marginBottom: 28 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: "100%", display: "flex", alignItems: "center" }}>
              {i > 0 && <div style={{ flex: 1, height: 1, background: i <= step - 1 ? "var(--accent)" : "var(--line)" }}/>}
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center",
                fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
                background: i + 1 < step ? "var(--accent)" : i + 1 === step ? "color-mix(in oklch,var(--accent) 20%,transparent)" : "var(--bg-2)",
                border: `1.5px solid ${i + 1 <= step ? "var(--accent)" : "var(--line)"}`,
                color: i + 1 < step ? "var(--bg)" : i + 1 === step ? "var(--accent)" : "var(--fg-dim)",
                flexShrink: 0,
              }}>{i + 1 < step ? "✓" : i + 1}</div>
              {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: i + 1 < step ? "var(--accent)" : "var(--line)" }}/>}
            </div>
            <div style={{ fontSize: 9, color: i + 1 === step ? "var(--accent)" : "var(--fg-dim)",
              fontFamily: "var(--font-mono)", textAlign: "center", letterSpacing: "0.04em" }}>{s}</div>
          </div>
        ))}
      </div>

      {err && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "color-mix(in oklch,var(--err) 8%,transparent)",
          border: "1px solid color-mix(in oklch,var(--err) 25%,var(--line))", fontSize: 11, color: "var(--err)", marginBottom: 14 }}>
          ⚠ {err}
        </div>
      )}

      {/* Step 1 — Sieć */}
      {step === 1 && (
        <div className="col" style={{ gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Konfiguracja sieci VPN</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {inp("Nazwa interfejsu", "interface", "wg0", "text", "Np. wg0, wg1, wg-home")}
            {inp("Port nasłuchiwania (UDP)", "listen_port", "51820", "number")}
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--fg-dim)", display: "block", marginBottom: 6,
              letterSpacing: "0.06em", textTransform: "uppercase" }}>Subnet VPN</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {[["10.8.0.1/24","10.8.0.x"],["10.10.0.1/24","10.10.0.x"],["172.16.0.1/24","172.16.0.x"],["192.168.99.1/24","192.168.99.x"]].map(([v,l]) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, address: v }))} style={{
                  padding: "3px 10px", borderRadius: 5, fontSize: 10, cursor: "pointer",
                  border: `1px solid ${form.address === v ? "var(--accent)" : "var(--line)"}`,
                  background: form.address === v ? "color-mix(in oklch,var(--accent) 10%,transparent)" : "var(--bg-2)",
                  color: form.address === v ? "var(--accent)" : "var(--fg-dim)",
                  fontFamily: "var(--font-mono)",
                }}>{l}</button>
              ))}
            </div>
            <input className="input" value={form.address} onChange={set("address")} placeholder="10.8.0.1/24"
              style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)",
                border: "1px solid var(--line)", padding: "7px 9px", borderRadius: 5, color: "var(--fg)" }}/>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {inp("DNS dla klientów", "dns", "1.1.1.1")}
            {inp("Endpont publiczny (opcjonalne)", "endpoint", "vpn.mojaserwernia.pl:51820", "text", "Zostawiasz puste → auto z hostname")}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
            <button className="btn primary" onClick={() => setStep(2)}>Dalej →</button>
          </div>
        </div>
      )}

      {/* Step 2 — Klucze */}
      {step === 2 && (
        <div className="col" style={{ gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Klucze kryptograficzne</div>
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-2)",
            border: "1px solid var(--line)", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
            💡 WireGuard używa kryptografii krzywych eliptycznych (Curve25519). Klucze są generowane
            na serwerze przez <code>wg genkey</code>. Klucz prywatny <strong>nigdy</strong> nie opuszcza serwera.
          </div>
          {!genKeys ? (
            <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={generateKeys}>
              {busy ? "⏳ Generuję…" : "🔑 Generuj parę kluczy"}
            </button>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {[["Klucz prywatny (serwer)", genKeys.private_key, "var(--err-dim, var(--warn))"],
                ["Klucz publiczny (serwer)", genKeys.public_key, "var(--ok)"],
                ["Preshared Key (PSK)", genKeys.preshared_key, "var(--accent)"]].map(([label, val, col]) => (
                <div key={label}>
                  <div style={{ fontSize: 9, color: "var(--fg-dim)", marginBottom: 3, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                  <div style={{ padding: "6px 10px", borderRadius: 5, background: "var(--bg-1)", border: "1px solid var(--line)",
                    fontFamily: "var(--font-mono)", fontSize: 10.5, color: col, wordBreak: "break-all" }}>{val}</div>
                </div>
              ))}
              <div style={{ fontSize: 10, color: "var(--warn)", marginTop: 4 }}>
                ⚠ Klucz prywatny zostanie zapisany tylko w <code>/etc/wireguard/{form.interface}.conf</code> (chmod 600).
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4 }}>
            <button className="btn ghost" onClick={() => setStep(1)}>← Wstecz</button>
            <button className="btn primary" disabled={!genKeys} onClick={() => setStep(3)}>Dalej →</button>
          </div>
        </div>
      )}

      {/* Step 3 — Zaawansowane */}
      {step === 3 && (
        <div className="col" style={{ gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Ustawienia zaawansowane</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {inp("MTU", "mtu", "1420", "number", "Domyślnie 1420 działa w większości sieci")}
            {inp("Interfejs NAT (PostUp/Down)", "nat_iface", "eth0", "text", "Interfejs wyjściowy dla masquerade")}
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 8, letterSpacing: "0.06em" }}>IPTABLES · NAT (PostUp / PostDown)</div>
            <pre style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--fg-dim)", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>
{`PostUp   = iptables -A FORWARD -i %i -j ACCEPT
           iptables -A FORWARD -o %i -j ACCEPT
           iptables -t nat -A POSTROUTING -o ${form.nat_iface} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT
           iptables -D FORWARD -o %i -j ACCEPT
           iptables -t nat -D POSTROUTING -o ${form.nat_iface} -j MASQUERADE`}
            </pre>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" id="wg-autostart" checked={form.autostart}
              onChange={e => setForm(f => ({ ...f, autostart: e.target.checked }))}
              style={{ width: 15, height: 15, cursor: "pointer" }}/>
            <label htmlFor="wg-autostart" style={{ fontSize: 12, cursor: "pointer" }}>
              Uruchom automatycznie przy starcie systemu (systemctl enable wg-quick@{form.interface})
            </label>
          </div>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in oklch,var(--accent) 6%,transparent)",
            border: "1px solid color-mix(in oklch,var(--accent) 20%,var(--line))", fontSize: 11, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--accent)" }}>📋 Podsumowanie konfiguracji</div>
            <div className="mono" style={{ fontSize: 10.5, display: "grid", gridTemplateColumns: "120px 1fr", gap: "3px 10px" }}>
              <span style={{ color: "var(--fg-dim)" }}>Interfejs</span><span>{form.interface}</span>
              <span style={{ color: "var(--fg-dim)" }}>Adres</span><span>{form.address}</span>
              <span style={{ color: "var(--fg-dim)" }}>Port UDP</span><span>{form.listen_port}</span>
              <span style={{ color: "var(--fg-dim)" }}>DNS</span><span>{form.dns}</span>
              <span style={{ color: "var(--fg-dim)" }}>MTU</span><span>{form.mtu}</span>
              <span style={{ color: "var(--fg-dim)" }}>Autostart</span><span>{form.autostart ? "✓ tak" : "✗ nie"}</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4 }}>
            <button className="btn ghost" onClick={() => setStep(2)}>← Wstecz</button>
            <button className="btn primary" disabled={busy} onClick={createInterface}>
              {busy ? "⏳ Tworzę…" : "⚙ Utwórz interfejs WireGuard"}
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Sukces */}
      {step === 4 && (
        <div className="col" style={{ gap: 14, textAlign: "center" }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>WireGuard skonfigurowany!</div>
          <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            Interfejs <strong>{form.interface}</strong> działa na porcie UDP <strong>{form.listen_port}</strong>.
            Możesz teraz dodawać peery.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button className="btn primary" onClick={onCreated}>🔑 Zarządzaj peerami</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── OpenVPN Info Panel ───────────────────────────────────────────────────────

const OpenVPNPanel = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");

  useEffect(() => {
    vpnApi("/api/vpn/openvpn").then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const doAction = async (id, act) => {
    setAction(act + id);
    await vpnApi(`/api/vpn/openvpn/${id}/${act}`, { method: "POST", credentials: "include" }).catch(() => {});
    const d = await vpnApi("/api/vpn/openvpn").catch(() => null);
    if (d) setData(d);
    setAction("");
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--fg-dim)" }}>Ładowanie…</div>;

  const configs = (data?.configs || []).filter(c => c && c !== "");

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">🔒 OpenVPN</div>
            <div className="card-sub">Konfiguracje w /etc/openvpn/</div>
          </div>
          <div className="card-actions">
            <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontFamily: "var(--font-mono)",
              fontWeight: 600, color: data?.active ? "var(--ok)" : "var(--fg-dim)",
              background: data?.active ? "color-mix(in oklch,var(--ok) 12%,transparent)" : "var(--bg-2)",
              border: `1px solid ${data?.active ? "color-mix(in oklch,var(--ok) 30%,var(--line))" : "var(--line)"}` }}>
              {data?.active ? "● AKTYWNY" : "○ NIEAKTYWNY"}
            </span>
          </div>
        </div>
        <div className="card-body">
          {configs.length === 0 ? (
            <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--fg-dim)" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Brak konfiguracji OpenVPN</div>
              <div style={{ fontSize: 11, marginTop: 6 }}>
                Umieść pliki .conf w <code>/etc/openvpn/</code> lub <code>/etc/openvpn/server/</code>
              </div>
            </div>
          ) : (
            <table className="table">
              <thead><tr><th>Plik konfiguracji</th><th style={{ width: 160 }}>Akcje</th></tr></thead>
              <tbody>
                {configs.map(c => {
                  const id = c.replace(/^.*\//, "").replace(/\.conf$/, "");
                  return (
                    <tr key={c}>
                      <td className="mono" style={{ fontSize: 11 }}>{c}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn sm ghost" disabled={!!action}
                            onClick={() => doAction(id, "start")}>Start</button>
                          <button className="btn sm ghost" disabled={!!action}
                            onClick={() => doAction(id, "stop")}>Stop</button>
                          <button className="btn sm ghost" disabled={!!action}
                            onClick={() => doAction(id, "restart")}>Restart</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><div className="card-title">Instrukcja konfiguracji</div></div></div>
        <div className="card-body col" style={{ gap: 10 }}>
          {[
            ["1. Easy-RSA — inicjalizacja PKI", "cd /usr/share/easy-rsa\n./easyrsa init-pki\n./easyrsa build-ca nopass"],
            ["2. Certyfikat serwera", "./easyrsa build-server-full server nopass\n./easyrsa gen-dh"],
            ["3. Certyfikat klienta", "./easyrsa build-client-full client1 nopass"],
            ["4. Uruchom serwer", "systemctl start openvpn@server\nsystemctl enable openvpn@server"],
          ].map(([title, code]) => (
            <div key={title}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 5, color: "var(--fg)" }}>{title}</div>
              <pre style={{ padding: "8px 12px", borderRadius: 6, background: "var(--bg-2)",
                border: "1px solid var(--line)", fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: "var(--accent)", lineHeight: 1.7, margin: 0 }}>{code}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── IPSec Info Panel ─────────────────────────────────────────────────────────

const IPSecPanel = () => {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction]   = useState("");

  useEffect(() => {
    vpnApi("/api/vpn/ipsec").then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const doAction = async (act) => {
    setAction(act);
    await vpnApi(`/api/vpn/ipsec/${act}`, { method: "POST", credentials: "include" }).catch(() => {});
    const d = await vpnApi("/api/vpn/ipsec").catch(() => null);
    if (d) setData(d);
    setAction("");
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--fg-dim)" }}>Ładowanie…</div>;

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">🛡 IPSec · strongSwan</div>
            <div className="card-sub">IKEv2 · natywne wsparcie iOS / macOS / Windows</div>
          </div>
          <div className="card-actions">
            <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
              color: data?.active ? "var(--ok)" : "var(--fg-dim)",
              background: data?.active ? "color-mix(in oklch,var(--ok) 12%,transparent)" : "var(--bg-2)",
              border: `1px solid ${data?.active ? "color-mix(in oklch,var(--ok) 30%,var(--line))" : "var(--line)"}` }}>
              {data?.active ? "● AKTYWNY" : "○ NIEAKTYWNY"}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {["start", "stop", "restart", "reload"].map(a => (
                <button key={a} className="btn sm ghost" disabled={!!action} onClick={() => doAction(a)}
                  style={{ textTransform: "capitalize" }}>{action === a ? "⏳…" : a}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="card-body">
          {data?.status ? (
            <pre style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-dim)",
              lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
              {data.status}
            </pre>
          ) : (
            <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--fg-dim)" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🛡</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>strongSwan nie jest uruchomiony</div>
              <div style={{ fontSize: 11, marginTop: 6 }}>Kliknij „start" aby uruchomić usługę IPSec</div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><div className="card-title">Szybki start IKEv2</div></div></div>
        <div className="card-body col" style={{ gap: 10 }}>
          {[
            ["1. Wygeneruj certyfikat CA", "ipsec pki --gen --type rsa --size 4096 \\\n  --outform pem > /etc/ipsec.d/private/ca-key.pem\n\nipsec pki --self --ca --lifetime 3650 \\\n  --in /etc/ipsec.d/private/ca-key.pem --type rsa \\\n  --dn \"CN=VPN CA\" --outform pem > /etc/ipsec.d/cacerts/ca-cert.pem"],
            ["2. Certyfikat serwera", "ipsec pki --gen --type rsa --size 2048 \\\n  --outform pem > /etc/ipsec.d/private/server-key.pem\n\nipsec pki --pub --in /etc/ipsec.d/private/server-key.pem --type rsa \\\n  | ipsec pki --issue --lifetime 1825 \\\n  --cacert /etc/ipsec.d/cacerts/ca-cert.pem \\\n  --cakey /etc/ipsec.d/private/ca-key.pem \\\n  --dn \"CN=vpn.serwer.pl\" --san \"vpn.serwer.pl\" \\\n  --flag serverAuth --flag ikeIntermediate \\\n  --outform pem > /etc/ipsec.d/certs/server-cert.pem"],
            ["3. Plik /etc/ipsec.conf", `config setup\n  charondebug="ike 1, knl 1, cfg 0"\n\nconn ikev2-vpn\n  auto=add\n  compress=no\n  type=tunnel\n  keyexchange=ikev2\n  ike=aes256-sha1-modp1024,3des-sha1-modp1024!\n  esp=aes256-sha1,3des-sha1!\n  dpdaction=clear\n  left=%defaultroute\n  leftid=@vpn.serwer.pl\n  leftcert=server-cert.pem\n  leftsendcert=always\n  leftsubnet=0.0.0.0/0\n  right=%any\n  rightid=%any\n  rightauth=eap-mschapv2\n  rightdns=8.8.8.8\n  rightsourceip=10.10.10.0/24`],
          ].map(([title, code]) => (
            <div key={title}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 5, color: "var(--fg)" }}>{title}</div>
              <pre style={{ padding: "8px 12px", borderRadius: 6, background: "var(--bg-2)",
                border: "1px solid var(--line)", fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--accent)", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{code}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Mini mapa świata ─────────────────────────────────────────────────────────

const VpnWorldMap = ({ peers, selectedId, onSelect, serverEndpoint }) => {
  const proj = (lat, lon) => ({ x: (lon + 10) * 20, y: (65 - lat) * 16 });
  const w = 800, h = 480;
  const server = proj(52.23, 21.01);
  const onlinePeers = peers.filter(p => p.state !== "offline");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <radialGradient id="vpn-map-glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
        </radialGradient>
        <pattern id="vpn-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0 L0 0 0 40" fill="none" stroke="var(--line)" strokeWidth="0.5" opacity="0.3"/>
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#vpn-map-grid)"/>
      <g opacity="0.18" stroke="var(--fg-muted)" strokeWidth="0.6" fill="none" strokeDasharray="2 3">
        <path d="M40 280 Q120 240 200 230 T380 220 T540 220 T700 260"/>
        <path d="M120 130 Q200 150 280 145 T440 155 T600 180"/>
        <path d="M180 360 Q280 340 380 348 T560 360 T700 380"/>
      </g>
      {[{lat:52.5,lon:19,label:"PL"},{lat:52.5,lon:13.4,label:"DE"},{lat:48.8,lon:2.3,label:"FR"},
        {lat:51.5,lon:-0.1,label:"UK"},{lat:41.9,lon:12.5,label:"IT"},{lat:60.2,lon:24.9,label:"FI"}]
       .map(c => { const p = proj(c.lat, c.lon); return <text key={c.label} x={p.x} y={p.y} fontSize="11" fontFamily="var(--font-mono)" fill="var(--fg-dim)" opacity="0.6" letterSpacing="0.1em">{c.label}</text>; })}
      <circle cx={server.x} cy={server.y} r="60" fill="url(#vpn-map-glow)"/>
      {onlinePeers.map(p => {
        const lat = p.lat || 52.2, lon = p.lon || 21.0;
        const pos = proj(lat, lon);
        if (Math.abs(pos.x - server.x) < 2 && Math.abs(pos.y - server.y) < 2) return null;
        const sel = selectedId === p.id;
        return (
          <g key={"l-"+p.id}>
            <line x1={server.x} y1={server.y} x2={pos.x} y2={pos.y}
              stroke={sel ? "var(--accent)" : "var(--ok)"}
              strokeWidth={sel ? 1.5 : 0.8} opacity={sel ? 0.9 : 0.45}
              strokeDasharray={p.state === "idle" ? "3 3" : "0"}/>
            {p.state === "online" && (
              <circle r="2.5" fill={sel ? "var(--accent)" : "var(--ok)"}>
                <animateMotion dur={`${2.5 + (p.id.charCodeAt(0) % 10) * 0.2}s`} repeatCount="indefinite" path={`M${server.x},${server.y} L${pos.x},${pos.y}`}/>
              </circle>
            )}
          </g>
        );
      })}
      <g transform={`translate(${server.x},${server.y})`}>
        <circle r="18" fill="var(--bg-2)" stroke="var(--accent)" strokeWidth="2"/>
        <circle r="14" fill="color-mix(in oklch,var(--accent) 18%,transparent)"/>
        <circle r="6" fill="var(--accent)"/>
        <text y="-26" textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--accent)" fontWeight="700" letterSpacing="0.08em">NIMBUS</text>
        <text y="32" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--fg-dim)">{serverEndpoint || "wg0"}</text>
      </g>
      {peers.map(p => {
        const lat = p.lat || 52.0, lon = p.lon || 19.0;
        const pos = proj(lat, lon);
        const meta = VPN_STATE_META[p.state] || VPN_STATE_META.offline;
        const sel = selectedId === p.id;
        return (
          <g key={p.id} transform={`translate(${pos.x},${pos.y})`} style={{ cursor: "pointer" }} onClick={() => onSelect(p.id)}>
            {sel && <circle r="14" fill="none" stroke="var(--accent)" strokeWidth="2"/>}
            <circle r="7" fill="var(--bg-2)" stroke={meta.color} strokeWidth="1.5"/>
            <circle r="3.5" fill={meta.color} opacity={p.state === "offline" ? 0.4 : 1}>
              {meta.pulse && <animate attributeName="r" values="3.5;5;3.5" dur="2s" repeatCount="indefinite"/>}
            </circle>
            <text y={sel ? -18 : 22} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)"
              fill={sel ? "var(--accent)" : "var(--fg-muted)"} fontWeight={sel ? 700 : 400}>
              {(p.name||"").split(" ")[0]}
            </text>
          </g>
        );
      })}
      <text x="16" y="16" fontSize="9" fontFamily="var(--font-mono)" fill="var(--fg-dim)" letterSpacing="0.1em">
        WIREGUARD MESH · {peers.length} peerów · {onlinePeers.length} online
      </text>
    </svg>
  );
};

// ─── Traffic chart ────────────────────────────────────────────────────────────

const VpnTrafficChart = ({ data = [] }) => {
  if (!data.length) return null;
  const w = 900, h = 140, pad = 24;
  const max = Math.max(...data, 1);
  const n = data.length;
  const x = i => pad + (i / (n - 1)) * (w - pad * 2);
  const y = v => h - pad - (v / max) * (h - pad * 2);
  const line = "M " + data.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
  const area = `${line} L ${x(n-1)},${h-pad} L ${x(0)},${h-pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 140 }}>
      <defs>
        <linearGradient id="vpn-traf-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#vpn-traf-grad)"/>
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5"/>
      {[0, Math.floor(n/4), Math.floor(n/2), Math.floor(3*n/4), n-1].map(i => (
        <text key={i} x={x(i)} y={h-4} fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)" textAnchor="middle">
          {i}h
        </text>
      ))}
    </svg>
  );
};

// ─── QR Code modal ───────────────────────────────────────────────────────────

const QRModal = ({ peer, iface, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    vpnApi(`/api/vpn/peers/${peer.id}/qr?iface=${iface}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [peer.id, iface]);

  const copyConf = () => {
    if (data?.conf) { navigator.clipboard.writeText(data.conf); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const downloadConf = () => {
    if (!data?.conf) return;
    const blob = new Blob([data.conf], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (peer.name || "peer").replace(/[^a-z0-9]/gi, "_") + ".conf";
    a.click();
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "color-mix(in oklch,var(--bg) 70%,black)",
      backdropFilter: "blur(6px)", display: "grid", placeItems: "center", zIndex: 1000, padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 12,
        padding: 24, maxWidth: 720, width: "100%",
        display: "grid", gridTemplateColumns: "auto 1fr", gap: 24,
        boxShadow: "0 24px 60px rgba(0,0,0,.4)",
      }}>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {loading ? (
            <div style={{ width: 240, height: 240, background: "var(--bg-3)", borderRadius: 8,
              display: "grid", placeItems: "center", color: "var(--fg-dim)", fontSize: 12 }}>Ładowanie…</div>
          ) : data?.qr_png_base64 ? (
            <img src={`data:image/png;base64,${data.qr_png_base64}`} style={{ width: 240, height: 240, borderRadius: 8 }}/>
          ) : data?.conf ? (
            <div style={{ width: 240, height: 240, background: "var(--bg-2)", borderRadius: 8,
              display: "grid", placeItems: "center", color: "var(--fg-dim)", fontSize: 11, padding: 16, textAlign: "center",
              border: "1px solid var(--line)" }}>
              <div>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
                <div>QR niedostępny</div>
                <div style={{ fontSize: 10, marginTop: 6, color: "var(--fg-dim)" }}>
                  Konfiguracja dostępna poniżej
                </div>
              </div>
            </div>
          ) : null}
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", textAlign: "center", letterSpacing: "0.08em" }}>
            ZESKANUJ APLIKACJĄ WIREGUARD
          </div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{peer.name}</span>
              <button className="icon-btn" onClick={onClose}><Icon name="close" size={14}/></button>
            </div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
              {peer.device} · {peer.ip} · utworzono {peer.created}
            </div>
          </div>
          <pre style={{
            padding: "12px 14px", borderRadius: 6, background: "var(--bg-2)",
            border: "1px solid var(--line)", fontFamily: "var(--font-mono)", fontSize: 10.5,
            lineHeight: 1.7, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
          }}>{data?.conf || "Ładowanie konfiguracji…"}</pre>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button className="btn" onClick={downloadConf} disabled={!data?.conf}>
              <Icon name="download" size={11}/> Pobierz .conf
            </button>
            <button className="btn" onClick={copyConf} disabled={!data?.conf}>
              {copied ? "✓ Skopiowano!" : "📋 Kopiuj conf"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--fg-muted)", lineHeight: 1.5,
            padding: "8px 0", borderTop: "1px solid var(--line)" }}>
            💡 <span style={{ color: "var(--warn)" }}>Klucz prywatny jest dostępny tylko przy tworzeniu peera.</span>{" "}
            Jeśli zgubiłeś config, usuń i utwórz peer ponownie.
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── New Peer Modal ────────────────────────────────────────────────────────────

const NewPeerModal = ({ iface, wgi, onCreated, onClose }) => {
  const [form, setForm] = useState({
    name: "", device: "", allowed_ips: "0.0.0.0/0", ip: "",
    location: "", country: "PL", lat: 52.23, lon: 21.01,
    dns: "", keepalive: 25,
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const triggerDownload = (conf, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([conf], { type: "text/plain" }));
    a.download = name.replace(/[^a-z0-9]/gi, "_") + ".conf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const create = async () => {
    if (!form.name.trim()) { setErr("Podaj nazwę peera"); return; }
    setSaving(true); setErr("");
    try {
      const d = await vpnPost("/api/vpn/peers", { ...form, iface, lat: +form.lat, lon: +form.lon, keepalive: +form.keepalive });
      // Automatyczny download .conf — bez klikania
      if (d.conf) triggerDownload(d.conf, form.name);
      setResult(d);
      onCreated && onCreated();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  const copyConf = () => {
    if (!result?.conf) return;
    navigator.clipboard.writeText(result.conf);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadConf = () => {
    if (result?.conf) triggerDownload(result.conf, form.name);
  };

  const inp = (label, key, placeholder, type = "text") => (
    <div>
      <label style={{ fontSize: 10, color: "var(--fg-dim)", display: "block", marginBottom: 3, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</label>
      <input className="input" type={type} value={form[key]} onChange={set(key)} placeholder={placeholder}
        style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)", border: "1px solid var(--line)", padding: "7px 9px", borderRadius: 5, color: "var(--fg)" }}/>
    </div>
  );

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "color-mix(in oklch,var(--bg) 60%,black)",
      backdropFilter: "blur(4px)", display: "grid", placeItems: "center", zIndex: 1000, padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 12,
        padding: 24, maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 24px 60px rgba(0,0,0,.4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>➕ Nowy peer WireGuard</div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>Interfejs: {iface}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={14}/></button>
        </div>

        {result ? (
          <div className="col" style={{ gap: 14 }}>
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "color-mix(in oklch,var(--ok) 8%,transparent)",
              border: "1px solid color-mix(in oklch,var(--ok) 25%,var(--line))", fontSize: 12 }}>
              <div>✅ Peer <strong>{result.name}</strong> utworzony · IP: <code>{result.ip}</code></div>
              <div style={{ fontSize: 11, color: "var(--ok)", marginTop: 4 }}>
                ⬇ Plik <strong>{form.name.replace(/[^a-z0-9]/gi, "_")}.conf</strong> został automatycznie pobrany
              </div>
            </div>
            <pre style={{ padding: 14, borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--line)",
              fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: 1.7, maxHeight: 280, overflow: "auto",
              whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{result.conf}</pre>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <button className="btn" onClick={downloadConf}><Icon name="download" size={11}/> Pobierz ponownie</button>
              <button className="btn" onClick={copyConf}>{copied ? "✓ Skopiowano!" : "📋 Kopiuj"}</button>
              <button className="btn primary" onClick={onClose}>Zamknij</button>
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <div className="grid grid-2-1" style={{ gap: 10 }}>
              {inp("Nazwa peera", "name", "iPhone · Kuba")}
              {inp("Urządzenie", "device", "iOS 18, Android 15, Linux…")}
            </div>
            {inp("VPN IP (pozostaw puste = auto)", "ip", "auto (np. 10.8.0.10)")}
            <div>
              <label style={{ fontSize: 10, color: "var(--fg-dim)", display: "block", marginBottom: 3, letterSpacing: "0.06em", textTransform: "uppercase" }}>ALLOWED IPs (routing klienta)</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {[["0.0.0.0/0", "Full tunnel (cały ruch)"], ["10.8.0.0/24", "Split tunnel (tylko VPN)"], ["192.168.1.0/24", "Split tunnel (LAN)"]].map(([v, l]) => (
                  <button key={v} onClick={() => setForm(f => ({ ...f, allowed_ips: v }))} style={{
                    padding: "3px 10px", borderRadius: 5, fontSize: 10, cursor: "pointer",
                    border: `1px solid ${form.allowed_ips === v ? "var(--accent)" : "var(--line)"}`,
                    background: form.allowed_ips === v ? "color-mix(in oklch,var(--accent) 10%,transparent)" : "var(--bg-2)",
                    color: form.allowed_ips === v ? "var(--accent)" : "var(--fg-dim)",
                  }}>{l}</button>
                ))}
              </div>
              <input className="input" value={form.allowed_ips} onChange={set("allowed_ips")}
                style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)", border: "1px solid var(--line)", padding: "7px 9px", borderRadius: 5, color: "var(--fg)" }}/>
            </div>
            <div className="grid grid-2-1" style={{ gap: 10 }}>
              {inp("DNS (puste = z serwera)", "dns", wgi?.dns || "1.1.1.1")}
              {inp("PersistentKeepalive", "keepalive", "25", "number")}
            </div>
            <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 8, letterSpacing: "0.06em" }}>LOKALIZACJA (do mapy — opcjonalne)</div>
              <div className="grid grid-2-1" style={{ gap: 8 }}>
                {inp("Opis lokalizacji", "location", "Warszawa · home")}
                {inp("Kraj (PL, DE…)", "country", "PL")}
              </div>
              <div className="grid grid-2-1" style={{ gap: 8, marginTop: 8 }}>
                {inp("Szerokość (lat)", "lat", "52.23", "number")}
                {inp("Długość (lon)", "lon", "21.01", "number")}
              </div>
            </div>
            {err && <div style={{ fontSize: 11, color: "var(--err)", padding: "6px 10px", borderRadius: 5,
              background: "color-mix(in oklch,var(--err) 8%,transparent)" }}>⚠ {err}</div>}
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", paddingTop: 4 }}>
              <button className="btn ghost" onClick={onClose}>Anuluj</button>
              <button className="btn primary" disabled={saving} onClick={create}>
                {saving ? "⏳ Tworzenie…" : "➕ Utwórz peer"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Edit Peer Modal ───────────────────────────────────────────────────────────

const EditPeerModal = ({ peer, onSaved, onClose }) => {
  const [form, setForm] = useState({
    name: peer.name || "", device: peer.device || "",
    location: peer.location || "", country: peer.country || "",
    lat: peer.lat || 52.23, lon: peer.lon || 21.01,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await vpnPatch(`/api/vpn/peers/${peer.id}`, { ...form, lat: +form.lat, lon: +form.lon });
    setSaving(false);
    onSaved && onSaved();
    onClose();
  };

  const inp = (label, key, placeholder) => (
    <div>
      <label style={{ fontSize: 10, color: "var(--fg-dim)", display: "block", marginBottom: 3, letterSpacing: "0.06em" }}>{label}</label>
      <input className="input" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder} style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)", border: "1px solid var(--line)", padding: "7px 9px", borderRadius: 5, color: "var(--fg)" }}/>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "color-mix(in oklch,var(--bg) 60%,black)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 12, padding: 24, maxWidth: 480, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>✏ Edytuj peer</span>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={13}/></button>
        </div>
        <div className="col" style={{ gap: 10 }}>
          <div className="grid grid-2-1" style={{ gap: 10 }}>
            {inp("Nazwa", "name", "iPhone · Kuba")}
            {inp("Urządzenie", "device", "iOS 18")}
          </div>
          <div className="grid grid-2-1" style={{ gap: 10 }}>
            {inp("Lokalizacja", "location", "Warszawa · home")}
            {inp("Kraj", "country", "PL")}
          </div>
          <div className="grid grid-2-1" style={{ gap: 10 }}>
            {inp("Lat", "lat", "52.23")}
            {inp("Lon", "lon", "21.01")}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={onClose}>Anuluj</button>
            <button className="btn primary" disabled={saving} onClick={save}>{saving ? "⏳…" : "Zapisz"}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Server Config Card ────────────────────────────────────────────────────────

const ServerConfigCard = ({ wgi, iface, onReload }) => {
  const [busy, setBusy]         = useState("");
  const [log, setLog]           = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [epSaved, setEpSaved]   = useState(false);
  const [epLoading, setEpLoading] = useState(true);

  // Ładuj zapisany endpoint przy montowaniu
  useEffect(() => {
    vpnApi(`/api/vpn/wireguard/${iface}/config`)
      .then(d => { setEndpoint(d.endpoint || ""); setEpLoading(false); })
      .catch(() => setEpLoading(false));
  }, [iface]);

  const saveEndpoint = async () => {
    setBusy("ep");
    await vpnApi(`/api/vpn/wireguard/${iface}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    setBusy(""); setEpSaved(true);
    setTimeout(() => setEpSaved(false), 2000);
  };

  const action = async (act) => {
    setBusy(act); setLog("");
    try {
      const r = await fetch(`/api/vpn/wireguard/${iface}/${act}`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLog(`❌ Błąd ${r.status}: ${d.error || d.output || r.statusText}`);
      } else {
        setLog(d.output || d.status || "OK");
        setTimeout(onReload, 1000);
      }
    } catch (e) {
      setLog("❌ " + e.message);
    } finally {
      setBusy("");
    }
  };

  const backup  = () => { window.open(`/api/vpn/wireguard/${iface}/backup`, "_blank"); };

  const showLogs = async () => {
    const d = await vpnApi(`/api/vpn/wireguard/${iface}/logs`);
    setLog((d.logs || []).join("\n"));
  };

  const genKeys = async () => {
    const d = await vpnApi("/api/vpn/wireguard-keys/generate", { method: "POST", credentials: "include" });
    setLog(`PrivateKey: ${d.private_key}\nPublicKey:  ${d.public_key}\nPresharedKey: ${d.preshared_key}`);
  };

  return (
    <div className="card">
      <div className="card-head">
        <div><div className="card-title">Konfiguracja serwera</div><div className="card-sub">/etc/wireguard/{iface}.conf</div></div>
      </div>
      <div className="card-body col" style={{ gap: 10 }}>

        {/* Endpoint — najważniejsze pole */}
        <div style={{ padding: "10px 12px", borderRadius: 6,
          background: "color-mix(in oklch,var(--accent) 6%,transparent)",
          border: "1px solid color-mix(in oklch,var(--accent) 20%,var(--line))" }}>
          <div style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600, letterSpacing: "0.06em",
            textTransform: "uppercase", marginBottom: 6 }}>
            Endpoint publiczny (wpisywany do .conf klientów)
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              value={epLoading ? "Ładowanie…" : endpoint}
              onChange={e => setEndpoint(e.target.value)}
              disabled={epLoading}
              placeholder="1.2.3.4:51820 lub vpn.firma.pl:51820"
              onKeyDown={e => e.key === "Enter" && saveEndpoint()}
              style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12,
                background: "var(--bg)", border: "1px solid var(--line)",
                padding: "7px 10px", borderRadius: 5, color: "var(--fg)" }}
            />
            <button className="btn sm primary" disabled={!!busy || epLoading} onClick={saveEndpoint}
              style={{ flexShrink: 0 }}>
              {busy === "ep" ? "⏳" : epSaved ? "✓ Zapisano" : "Zapisz"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 5 }}>
            Publiczny adres IP lub domena serwera + port UDP · używany przy tworzeniu nowych peerów
          </div>
        </div>

        {/* Parametry interfejsu */}
        <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg-2)",
          border: "1px solid var(--line)", fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.8 }}>
          <div><span style={{ color: "var(--fg-dim)" }}>[Interface]</span></div>
          <div><span style={{ color: "var(--accent)" }}>Address</span> = {wgi?.subnet || "—"}</div>
          <div><span style={{ color: "var(--accent)" }}>ListenPort</span> = {wgi?.listen_port || 51820}</div>
          {wgi?.mtu && <div><span style={{ color: "var(--accent)" }}>MTU</span> = {wgi.mtu}</div>}
          {wgi?.dns && <div><span style={{ color: "var(--accent)" }}>DNS</span> = {wgi.dns}</div>}
          <div style={{ marginTop: 6 }}><span style={{ color: "var(--fg-dim)" }}>PublicKey:</span></div>
          <div style={{ wordBreak: "break-all", color: "var(--accent)", fontSize: 10 }}>{wgi?.pubkey || "—"}</div>
        </div>

        <div className="mono" style={{ fontSize: 11, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px" }}>
          {wgi?.uptime && <><span style={{ color: "var(--fg-dim)" }}>uptime</span><span>{wgi.uptime}</span></>}
          <span style={{ color: "var(--fg-dim)" }}>↓ total</span><span style={{ color: "var(--accent)" }}>{fmtGB(wgi?.total_rx)}</span>
          <span style={{ color: "var(--fg-dim)" }}>↑ total</span><span style={{ color: "var(--ok)" }}>{fmtGB(wgi?.total_tx)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {wgi?.state !== "up" ? (
            <button className="btn sm primary" disabled={!!busy} onClick={() => action("start")}
              style={{ gridColumn: "1 / -1", background: "var(--ok)", borderColor: "var(--ok)" }}>
              <Icon name="play" size={11}/> {busy === "start" ? "⏳ Uruchamianie…" : "▶ Start wg0"}
            </button>
          ) : (
            <>
              <button className="btn ghost sm" disabled={!!busy} onClick={() => action("restart")}>
                <Icon name="restart" size={11}/> {busy === "restart" ? "⏳…" : "Restart"}
              </button>
              <button className="btn ghost sm" disabled={!!busy} onClick={() => action("stop")}
                style={{ color: "var(--err-dim, var(--err))" }}>
                <Icon name="close" size={11}/> {busy === "stop" ? "⏳…" : "Stop"}
              </button>
            </>
          )}
          <button className="btn ghost sm" onClick={backup}>
            <Icon name="download" size={11}/> Backup config
          </button>
          <button className="btn ghost sm" onClick={genKeys}>
            <Icon name="key" size={11}/> Generuj klucze
          </button>
          <button className="btn ghost sm" onClick={showLogs} style={{ gridColumn: "1 / -1" }}>
            <Icon name="log" size={11}/> Logi
          </button>
        </div>
        {log && (
          <pre style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 6,
            padding: "8px 10px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--fg-dim)",
            maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{log}</pre>
        )}
      </div>
    </div>
  );
};

// ─── WireGuard Dashboard (główny panel) ───────────────────────────────────────

const WireGuardDashboard = ({ installed, onInstalled }) => {
  // ── Blokada przed fetchem gdy nie zainstalowany ──
  // Musi być PRZED każdym hookiem — React wymaga stałej kolejności hooków,
  // więc deklarujemy wszystkie hooki bezwarunkowo, ale fetch jest warunkowany flagą.
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(installed !== false);
  const [selectedPeer, setSel]  = useState(null);
  const [showQR, setShowQR]     = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const [editPeer, setEditPeer] = useState(null);
  const [filter, setFilter]     = useState("all");
  const [iface, setIface]       = useState("wg0");
  const [deleting, setDeleting] = useState(null);
  const [showConfigurator, setShowConfigurator] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await vpnApi(`/api/vpn/wireguard?iface=${iface}`);
      setData(d);
      if (!selectedPeer && d.peers?.length) setSel(d.peers[0].id);
    } catch {}
    setLoading(false);
  }, [iface]);

  useEffect(() => {
    // Nie odpytuj API jeśli WireGuard nie jest zainstalowany
    if (installed === false) { setLoading(false); return; }
    setLoading(true);
    load();
    pollRef.current = setInterval(load, 5000);
    return () => clearInterval(pollRef.current);
  }, [load, installed]);

  const [deleteErr, setDeleteErr] = useState("");

  const deletePeer = async (pub) => {
    setDeleting(pub); setDeleteErr("");
    try {
      await vpnDelete(`/api/vpn/peers/${pub}?iface=${iface}`);
      if (selectedPeer === pub) setSel(null);
      load();
    } catch (e) {
      setDeleteErr("Błąd usuwania: " + e.message);
    } finally {
      setDeleting(null);
    }
  };

  // ── Nie zainstalowany — pokaż baner, nie renderuj reszty ──
  if (installed === false) {
    return (
      <div className="card">
        <InstallBanner module="wireguard" onInstalled={onInstalled}/>
      </div>
    );
  }

  const peers  = data?.peers  || [];
  const wgi    = data?.interface || {};
  const ifaces = data?.ifaces  || [];

  const filtered = filter === "all" ? peers : peers.filter(p => p.state === filter);
  const sel      = peers.find(p => p.id === selectedPeer);
  const onlineCount = peers.filter(p => p.state === "online").length;
  const idleCount   = peers.filter(p => p.state === "idle").length;
  const trafficData = Array.from({ length: 24 }, (_, i) => Math.max(4, Math.sin(i/3.8) * 40 + 40 + Math.random() * 20));

  // WireGuard zainstalowany, ale brak konfiguracji — pokaż konfigurator
  if (!loading && !data) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">🔐 Konfiguracja WireGuard</div>
            <div className="card-sub">WireGuard jest zainstalowany — skonfiguruj interfejs serwera</div>
          </div>
        </div>
        <div className="card-body">
          <WgConfigurator onCreated={load}/>
        </div>
      </div>
    );
  }

  // WireGuard zainstalowany, ale brak konfiguracji — pokaż konfigurator
  if (!loading && wgi.state !== "up" && ifaces.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">🔐 Konfiguracja WireGuard</div>
            <div className="card-sub">WireGuard jest zainstalowany — skonfiguruj interfejs serwera</div>
          </div>
        </div>
        <div className="card-body">
          <WgConfigurator onCreated={load}/>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>

      {/* Przełącznik interfejsów + przycisk konfiguracji */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {ifaces.length > 1 && ifaces.map(i => (
          <button key={i} className={"btn sm " + (iface === i ? "primary" : "")} onClick={() => setIface(i)}>{i}</button>
        ))}
        <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => setShowConfigurator(v => !v)}>
          ⚙ {showConfigurator ? "Ukryj konfigurator" : "Nowy interfejs"}
        </button>
      </div>

      {/* Inline konfigurator */}
      {showConfigurator && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">⚙ Nowy interfejs WireGuard</div></div>
            <button className="icon-btn" onClick={() => setShowConfigurator(false)}><Icon name="close" size={13}/></button>
          </div>
          <div className="card-body">
            <WgConfigurator onCreated={() => { setShowConfigurator(false); load(); }}/>
          </div>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-4">
        <div className="kpi" style={{ borderColor: wgi.state === "up" ? "color-mix(in oklch,var(--ok) 35%,var(--line))" : "color-mix(in oklch,var(--err) 35%,var(--line))" }}>
          <div className="kpi-label"><Icon name="shield" size={12}/> SERWER WIREGUARD</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%",
              background: wgi.state === "up" ? "var(--ok)" : "var(--err)",
              boxShadow: wgi.state === "up" ? "0 0 0 3px color-mix(in oklch,var(--ok) 30%,transparent),0 0 12px var(--ok)" : "none",
              animation: wgi.state === "up" ? "pulse 2.2s ease-in-out infinite" : "none" }}/>
            <span style={{ fontSize: 16, fontWeight: 600, color: wgi.state === "up" ? "var(--ok)" : "var(--err)" }}>
              {wgi.state === "up" ? "UP" : "DOWN"} · {iface}
            </span>
          </div>
          <div className="kpi-foot" style={{ marginTop: 8 }}>
            <span>{wgi.subnet || "—"}</span>
            <span>:{wgi.listen_port || 51820}</span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="users" size={12}/> PEERY</div>
          <div className="kpi-value">{onlineCount}<span className="kpi-unit">/ {peers.length}</span></div>
          <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
            {peers.map(p => (
              <span key={p.id} title={p.name} style={{ flex: 1, height: 5, borderRadius: 1,
                background: VPN_STATE_META[p.state]?.color || "var(--fg-dim)",
                opacity: p.state === "offline" ? 0.35 : 1 }}/>
            ))}
          </div>
          <div className="kpi-foot" style={{ marginTop: 4 }}>
            <span>{idleCount} idle</span>
            <span>{peers.length - onlineCount - idleCount} offline</span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="download" size={12}/> RUCH ŁĄCZNIE</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>
            {fmtGB((wgi.total_rx||0) + (wgi.total_tx||0))}
          </div>
          <div className="kpi-foot" style={{ marginTop: 6 }}>
            <span style={{ color: "var(--accent)" }}>↓ {fmtGB(wgi.total_rx)}</span>
            <span style={{ color: "var(--ok)" }}>↑ {fmtGB(wgi.total_tx)}</span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="globe" size={12}/> KRAJE</div>
          <div className="kpi-value">{new Set(peers.map(p => p.country).filter(Boolean)).size || "—"}</div>
          <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
            {Array.from(new Set(peers.map(p => p.country).filter(Boolean))).map(c => (
              <span key={c} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, fontFamily: "var(--font-mono)",
                background: "color-mix(in oklch,var(--accent) 12%,transparent)", color: "var(--accent)", fontWeight: 600 }}>{c}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Mapa + Server config */}
      <div className="grid grid-2-1">
        <div className="card" style={{ padding: 0 }}>
          <div className="card-head">
            <div><div className="card-title">Mapa peerów</div><div className="card-sub">live connections · klik = szczegóły</div></div>
            <div className="card-actions">
              {["online","idle"].map(s => (
                <span key={s} className="chip mono" style={{ fontSize: 10 }}>
                  <span style={{ width: 6, height: 6, background: VPN_STATE_META[s].color, borderRadius: "50%", display: "inline-block", marginRight: 4 }}/>{s}
                </span>
              ))}
            </div>
          </div>
          <div style={{ padding: 12, height: 480 }}>
            {loading ? (
              <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--fg-dim)" }}>Ładowanie…</div>
            ) : (
              <VpnWorldMap peers={peers} selectedId={selectedPeer} onSelect={setSel} serverEndpoint={wgi.endpoint}/>
            )}
          </div>
        </div>
        <ServerConfigCard wgi={wgi} iface={iface} onReload={load}/>
      </div>

      {/* 24h traffic */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Łączny ruch · 24h</div><div className="card-sub">wszystkie peery · MB/s</div></div>
        </div>
        <div className="card-body">
          <VpnTrafficChart data={trafficData}/>
        </div>
      </div>

      {/* Tabela peerów */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Peery</div>
            <div className="card-sub">{filtered.length} z {peers.length}</div>
          </div>
          <div className="card-actions" style={{ gap: 4 }}>
            {[["all","wszystkie"],["online","online"],["idle","idle"],["offline","offline"]].map(([id, l]) => (
              <button key={id} className={"btn sm " + (filter === id ? "primary" : "")}
                style={{ padding: "3px 9px", fontSize: 10 }} onClick={() => setFilter(id)}>{l}</button>
            ))}
            <button className="btn sm primary" style={{ marginLeft: 8 }} onClick={() => setShowNew(true)}>
              <Icon name="plus" size={10}/> Nowy peer
            </button>
          </div>
        </div>
        {deleteErr && (
          <div style={{ margin: "0 16px 0", padding: "8px 12px", borderRadius: 6, fontSize: 11,
            background: "color-mix(in oklch,var(--err) 8%,transparent)",
            border: "1px solid color-mix(in oklch,var(--err) 25%,var(--line))",
            color: "var(--err)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            ⚠ {deleteErr}
            <button className="icon-btn" style={{ fontSize: 11 }} onClick={() => setDeleteErr("")}>✕</button>
          </div>
        )}

        {loading && peers.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--fg-dim)" }}>Ładowanie…</div>
        ) : peers.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-dim)" }}>Brak peerów WireGuard</div>
            <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 6 }}>Kliknij „Nowy peer" aby dodać pierwsze urządzenie</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Stan</th>
                <th>Nazwa · urządzenie</th>
                <th style={{ width: 110 }}>VPN IP</th>
                <th>Lokalizacja</th>
                <th style={{ width: 100 }}>Handshake</th>
                <th style={{ width: 180 }}>Ruch</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const meta = VPN_STATE_META[p.state] || VPN_STATE_META.offline;
                return (
                  <tr key={p.id} className={selectedPeer === p.id ? "selected" : ""}
                    onClick={() => setSel(p.id)} style={{ cursor: "pointer" }}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color,
                          boxShadow: meta.pulse ? `0 0 6px ${meta.color}` : "none",
                          animation: meta.pulse ? "pulse 2s ease-in-out infinite" : "none" }}/>
                        <span className="mono" style={{ fontSize: 10, color: meta.color, fontWeight: 600, letterSpacing: "0.05em" }}>
                          {meta.label}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{p.name || p.id}</div>
                      <div className="mono dim" style={{ fontSize: 10 }}>{p.device || "—"}</div>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>{p.ip || p.allowed_ips?.split(",")[0]?.split("/")[0] || "—"}</td>
                    <td>
                      <div style={{ fontSize: 11 }}>{p.location || "—"}</div>
                      <div className="mono dim" style={{ fontSize: 10 }}>{p.country || ""}</div>
                    </td>
                    <td className="mono dim" style={{ fontSize: 11 }}>{p.last_handshake || "—"}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      <span style={{ color: "var(--accent)" }}>↓ {fmtGB(p.rx)}</span>
                      <span style={{ color: "var(--fg-dim)", margin: "0 4px" }}>·</span>
                      <span style={{ color: "var(--ok)" }}>↑ {fmtGB(p.tx)}</span>
                    </td>
                    <td style={{ width: 90 }}>
                      <div style={{ display: "flex", gap: 2 }} onClick={e => e.stopPropagation()}>
                        <button className="icon-btn" title="QR / Config"
                          onClick={() => { setSel(p.id); setShowQR(true); }}>
                          <Icon name="grid" size={11}/>
                        </button>
                        <button className="icon-btn" title="Edytuj"
                          onClick={() => setEditPeer(p)}>
                          <Icon name="edit" size={11}/>
                        </button>
                        <button className="icon-btn" title="Usuń"
                          disabled={deleting === p.public_key}
                          onClick={() => { if (confirm(`Usunąć peer "${p.name}"?`)) deletePeer(p.public_key || p.id); }}
                          style={{ color: deleting === p.public_key ? "var(--fg-dim)" : "var(--err-dim, var(--err))" }}>
                          <Icon name="trash" size={11}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showQR && sel && <QRModal peer={sel} iface={iface} onClose={() => setShowQR(false)}/>}
      {showNew && <NewPeerModal iface={iface} wgi={wgi} onCreated={load} onClose={() => setShowNew(false)}/>}
      {editPeer && <EditPeerModal peer={editPeer} onSaved={load} onClose={() => setEditPeer(null)}/>}
    </div>
  );
};

// ─── Główny komponent VPN — selektor modułów ──────────────────────────────────

const Vpn = () => {
  const [overview, setOverview] = useState(null);
  const [module, setModule]     = useState("wireguard");

  const reloadOverview = useCallback(() => {
    vpnApi("/api/vpn/overview").then(d => setOverview(d)).catch(() => {});
  }, []);

  useEffect(() => { reloadOverview(); }, [reloadOverview]);

  // overview === null → jeszcze ładujemy, nie znamy stanu
  const wgInstalled   = overview === null ? null : (overview?.wireguard?.installed !== false);
  const ovpnInstalled = overview === null ? null : (overview?.openvpn?.installed  !== false);
  const ipsecInstalled= overview === null ? null : (overview?.ipsec?.installed    !== false);

  const MODULES = [
    {
      id:        "wireguard",
      label:     "WireGuard",
      emoji:     "🔐",
      desc:      "Nowoczesny · szybki · peer-to-peer",
      installed: wgInstalled,
      active:    overview?.wireguard?.active,
    },
    {
      id:        "openvpn",
      label:     "OpenVPN",
      emoji:     "🔒",
      desc:      "SSL/TLS · kompatybilny z każdym urządzeniem",
      installed: ovpnInstalled,
      active:    overview?.openvpn?.active,
    },
    {
      id:        "ipsec",
      label:     "IPSec / IKEv2",
      emoji:     "🛡",
      desc:      "Natywny w iOS · macOS · Windows",
      installed: ipsecInstalled,
      active:    overview?.ipsec?.active,
    },
  ];

  const moduleBadge = (m) => {
    if (m.installed === null) return null;
    if (!m.installed) return { label: "⬇ NIE ZAINSTALOWANY", color: "var(--fg-dim)",  bg: "var(--bg-3)",                                          border: "var(--line)" };
    if (m.active)     return { label: "● AKTYWNY",            color: "var(--ok)",      bg: "color-mix(in oklch,var(--ok) 12%,transparent)",         border: "color-mix(in oklch,var(--ok) 25%,var(--line))" };
    return               { label: "○ NIEAKTYWNY",             color: "var(--warn)",    bg: "color-mix(in oklch,var(--warn) 10%,transparent)",        border: "color-mix(in oklch,var(--warn) 25%,var(--line))" };
  };

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>

      {/* ── Selektor modułu ── */}
      <div className="card" style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
          {MODULES.map(m => {
            const badge = moduleBadge(m);
            return (
              <button key={m.id} onClick={() => setModule(m.id)} style={{
                flex: "1 1 160px", padding: "12px 14px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                background: module === m.id ? "color-mix(in oklch,var(--accent) 8%,transparent)" : "var(--bg-2)",
                border: `1.5px solid ${module === m.id ? "var(--accent)" : "var(--line)"}`,
                transition: "all .15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 18 }}>{m.emoji}</span>
                  {badge && (
                    <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.04em",
                      padding: "2px 6px", borderRadius: 4, color: badge.color, background: badge.bg,
                      border: `1px solid ${badge.border}` }}>{badge.label}</span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: module === m.id ? "var(--accent)" : "var(--fg)", marginBottom: 2 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 10, color: "var(--fg-dim)", lineHeight: 1.4 }}>{m.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Zawartość modułu ── */}
      {module === "wireguard" && (
        <WireGuardDashboard installed={wgInstalled} onInstalled={reloadOverview}/>
      )}
      {module === "openvpn" && (
        !ovpnInstalled ? (
          <div className="card">
            <InstallBanner module="openvpn" onInstalled={reloadOverview}/>
          </div>
        ) : <OpenVPNPanel/>
      )}
      {module === "ipsec" && (
        !ipsecInstalled ? (
          <div className="card">
            <InstallBanner module="ipsec" onInstalled={reloadOverview}/>
          </div>
        ) : <IPSecPanel/>
      )}
    </div>
  );
};

window.Vpn = Vpn;
