import { getQueryParam } from "./url.js";
import { getSupabase } from "./supabase.js";
import { getSessionToken } from "./session.js";
import { navigate } from "./url.js";

const nightId = getQueryParam("id");
const groupId = getQueryParam("groupId");

const missing = document.getElementById("state-missing");
const ok = document.getElementById("state-ok");

function formatCents(cents) {
  const value = Number(cents ?? 0) / 100;
  return value.toLocaleString(undefined, { style: "currency", currency: "EUR" });
}

function parseMoneyToCents(value) {
  if (value == null) return 0;
  const s = String(value).trim().replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = String(v);
      else if (k === "text") node.textContent = String(v);
      else if (k === "value") node.value = String(v);
      else node.setAttribute(k, String(v));
    }
  }
  if (children) for (const c of children) node.append(c);
  return node;
}

async function loadNightData({ nightId, groupId }) {
  const supabase = await getSupabase();

  const [{ data: night, error: nightErr }, { data: players, error: playersErr }, { data: results, error: resultsErr }] =
    await Promise.all([
      supabase.from("nights").select("id,group_id,played_on,notes,created_at").eq("id", nightId).single(),
      groupId
        ? supabase.from("players").select("id,name,created_at").eq("group_id", groupId).order("created_at", { ascending: true })
        : supabase.from("players").select("id,name,created_at").eq("group_id", "__missing__"),
      supabase.from("night_results").select("night_id,player_id,buy_in_cents,cash_out_cents").eq("night_id", nightId),
    ]);

  if (nightErr) throw nightErr;
  if (playersErr) throw playersErr;
  if (resultsErr) throw resultsErr;

  if (groupId && night.group_id !== groupId) {
    // still allow viewing, but keep navigation correct (the url should include the real groupId)
    console.warn("groupId param did not match night.group_id");
  }

  return { night, players: players ?? [], results: results ?? [] };
}

function renderResults({ players, results }) {
  const body = document.getElementById("results-body");
  if (!body) return;
  body.innerHTML = "";

  /** @type {Map<string, {buy_in_cents:number, cash_out_cents:number}>} */
  const byPlayer = new Map();
  for (const r of results) {
    byPlayer.set(r.player_id, {
      buy_in_cents: Number(r.buy_in_cents ?? 0),
      cash_out_cents: Number(r.cash_out_cents ?? 0),
    });
  }

  if (!players.length) {
    body.append(
      el("tr", null, [el("td", { colspan: "4", class: "placeholder", text: "No players yet — add players in the group dashboard." })])
    );
    return;
  }

  for (const p of players) {
    const existing = byPlayer.get(p.id) ?? { buy_in_cents: 0, cash_out_cents: 0 };
    const buyInInput = el("input", {
      type: "number",
      step: "0.01",
      inputmode: "decimal",
      value: (existing.buy_in_cents / 100).toFixed(2),
      "data-player-id": p.id,
      "data-kind": "buyin",
      style: "width: 7.5rem;",
    });
    const cashOutInput = el("input", {
      type: "number",
      step: "0.01",
      inputmode: "decimal",
      value: (existing.cash_out_cents / 100).toFixed(2),
      "data-player-id": p.id,
      "data-kind": "cashout",
      style: "width: 7.5rem;",
    });
    const netCell = el("td", { class: "num", text: formatCents(existing.cash_out_cents - existing.buy_in_cents) });

    const recalc = () => {
      const buy = parseMoneyToCents(buyInInput.value);
      const cash = parseMoneyToCents(cashOutInput.value);
      netCell.textContent = formatCents(cash - buy);
    };

    buyInInput.addEventListener("input", recalc);
    cashOutInput.addEventListener("input", recalc);

    body.append(
      el("tr", null, [
        el("td", { text: p.name }),
        el("td", { class: "num" }, [buyInInput]),
        el("td", { class: "num" }, [cashOutInput]),
        netCell,
      ])
    );
  }
}

function collectResultsPayload() {
  const body = document.getElementById("results-body");
  if (!body) return [];

  /** @type {Map<string, {player_id:string, buy_in_cents:number, cash_out_cents:number}>} */
  const acc = new Map();

  for (const input of body.querySelectorAll("input[data-player-id][data-kind]")) {
    const playerId = input.getAttribute("data-player-id");
    const kind = input.getAttribute("data-kind");
    if (!playerId || !kind) continue;

    const row = acc.get(playerId) ?? { player_id: playerId, buy_in_cents: 0, cash_out_cents: 0 };
    if (kind === "buyin") row.buy_in_cents = parseMoneyToCents(input.value);
    if (kind === "cashout") row.cash_out_cents = parseMoneyToCents(input.value);
    acc.set(playerId, row);
  }

  return Array.from(acc.values());
}

if (!nightId) {
  ok.hidden = true;
} else {
  missing.hidden = true;
  ok.hidden = false;
  const short = nightId.length > 8 ? `${nightId.slice(0, 8)}…` : nightId;
  const title = document.getElementById("night-title");
  const crumb = document.getElementById("night-crumb-label");
  if (title) title.textContent = `Night ${short}`;
  if (crumb) crumb.textContent = short;

  const link = document.getElementById("link-parent-group");
  if (link) {
    link.href = groupId
      ? `./group.html?id=${encodeURIComponent(groupId)}`
      : "./index.html";
  }

  void (async () => {
    try {
      const btnSave = document.getElementById("btn-save-results");
      const meta = document.getElementById("night-meta");

      const effectiveGroupId = groupId;
      if (!effectiveGroupId) {
        if (meta) meta.textContent = "Missing groupId in URL — go back to the group page.";
        if (btnSave) btnSave.disabled = true;
        return;
      }

      const refresh = async () => {
        const data = await loadNightData({ nightId, groupId: effectiveGroupId });
        if (title) title.textContent = `Night ${data.night.played_on}`;
        if (crumb) crumb.textContent = String(data.night.played_on ?? short);
        if (meta) {
          meta.textContent = data.night.notes
            ? `${data.night.played_on} • ${data.night.notes}`
            : String(data.night.played_on ?? "");
        }
        renderResults({ players: data.players, results: data.results });
      };

      if (btnSave) {
        btnSave.addEventListener("click", async () => {
          try {
            const token = getSessionToken(effectiveGroupId);
            if (!token) {
              alert("Please open the group dashboard and log in first.");
              navigate("./group.html", { id: effectiveGroupId });
              return;
            }
            const payload = collectResultsPayload();
            const supabase = await getSupabase();
            const { error } = await supabase.rpc("upsert_night_results", {
              p_group_id: effectiveGroupId,
              p_session_token: token,
              p_night_id: nightId,
              p_results: payload,
            });
            if (error) throw error;
            await refresh();
            alert("Saved.");
          } catch (err) {
            alert(`Could not save: ${err?.message ?? err}`);
          }
        });
      }

      await refresh();
    } catch (err) {
      alert(`Could not load night: ${err?.message ?? err}`);
    }
  })();
}
