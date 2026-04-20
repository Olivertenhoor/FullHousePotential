import { getQueryParam } from "./url.js";
import { getSupabase } from "./supabase.js";
import { navigate } from "./url.js";
import { clearSessionToken, ensureLoggedIn, getSessionToken } from "./session.js";

const id = getQueryParam("id");
const code = getQueryParam("code");
const missing = document.getElementById("state-missing");
const ok = document.getElementById("state-ok");

function formatCents(cents) {
  const value = Number(cents ?? 0) / 100;
  return value.toLocaleString(undefined, { style: "currency", currency: "EUR" });
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = String(v);
      else if (k === "text") node.textContent = String(v);
      else node.setAttribute(k, String(v));
    }
  }
  if (children) {
    for (const c of children) node.append(c);
  }
  return node;
}

async function loadDashboardById(groupId) {
  const supabase = await getSupabase();

  const [{ data: group, error: groupErr }, { data: players, error: playersErr }, { data: nights, error: nightsErr }, { data: results, error: resultsErr }] =
    await Promise.all([
      supabase.from("groups").select("id,name,code,created_at").eq("id", groupId).single(),
      supabase.from("players").select("id,name,created_at").eq("group_id", groupId).order("created_at", { ascending: true }),
      supabase.from("nights").select("id,played_on,notes,created_at").eq("group_id", groupId).order("played_on", { ascending: false }),
      supabase
        .from("night_results")
        .select("night_id,player_id,buy_in_cents,cash_out_cents,players!inner(id,name,group_id)")
        .eq("players.group_id", groupId),
    ]);

  if (groupErr) throw groupErr;
  if (playersErr) throw playersErr;
  if (nightsErr) throw nightsErr;
  if (resultsErr) throw resultsErr;

  return { group, players: players ?? [], nights: nights ?? [], results: results ?? [] };
}

async function loadDashboardByCode(groupCode) {
  const supabase = await getSupabase();
  const { data: group, error } = await supabase
    .from("groups")
    .select("id,name,code,created_at")
    .eq("code", groupCode)
    .single();
  if (error) throw error;
  return await loadDashboardById(group.id);
}

function renderLeaderboard({ players, results }) {
  const body = document.getElementById("leaderboard-body");
  if (!body) return;
  body.innerHTML = "";

  /** @type {Map<string, {playerId: string, name: string, nights: Set<string>, net: number}>} */
  const acc = new Map();

  for (const p of players) {
    acc.set(p.id, { playerId: p.id, name: p.name, nights: new Set(), net: 0 });
  }

  for (const r of results) {
    const row = acc.get(r.player_id);
    if (!row) continue;
    row.nights.add(r.night_id);
    row.net += (Number(r.cash_out_cents ?? 0) - Number(r.buy_in_cents ?? 0));
  }

  const rows = Array.from(acc.values()).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));

  if (rows.length === 0) {
    body.append(
      el("tr", null, [el("td", { colspan: "3", class: "placeholder", text: "No players yet." })])
    );
    return;
  }

  for (const r of rows) {
    body.append(
      el("tr", null, [
        el("td", { text: r.name }),
        el("td", { class: "num", text: String(r.nights.size) }),
        el("td", { class: "num", text: formatCents(r.net) }),
      ])
    );
  }
}

function renderPlayersList(players) {
  const placeholder = document.getElementById("players-placeholder");
  const list = document.getElementById("players-list");
  if (!list) return;
  list.innerHTML = "";

  if (!players.length) {
    if (placeholder) placeholder.hidden = false;
    list.hidden = true;
    return;
  }

  if (placeholder) placeholder.hidden = true;
  list.hidden = false;
  for (const p of players) {
    list.append(el("li", null, [el("span", { text: p.name })]));
  }
}

function renderNightsList(groupId, nights) {
  const placeholder = document.getElementById("nights-placeholder");
  const list = document.getElementById("nights-list");
  if (!list) return;
  list.innerHTML = "";

  if (!nights.length) {
    if (placeholder) placeholder.hidden = false;
    list.hidden = true;
    return;
  }

  if (placeholder) placeholder.hidden = true;
  list.hidden = false;
  for (const n of nights) {
    const label = n.played_on ? String(n.played_on) : n.id;
    const link = el("a", { href: "#", text: label });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigate("./night.html", { id: n.id, groupId });
    });
    list.append(el("li", null, [link]));
  }
}

async function createPlayer(groupId, sessionToken) {
  const name = window.prompt("Player name?");
  if (!name) return;

  const supabase = await getSupabase();
  const { error } = await supabase.rpc("create_player", {
    p_group_id: groupId,
    p_session_token: sessionToken,
    p_name: name,
  });
  if (error) throw error;
}

async function createNight(groupId, sessionToken) {
  const playedOn = window.prompt("Night date (YYYY-MM-DD)?", new Date().toISOString().slice(0, 10));
  if (!playedOn) return;
  const notes = window.prompt("Notes (optional):", "") ?? null;

  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("create_night", {
    p_group_id: groupId,
    p_session_token: sessionToken,
    p_played_on: playedOn,
    p_notes: notes,
  });
  if (error) throw error;
  if (data) navigate("./night.html", { id: String(data), groupId });
}

if (!id && !code) {
  ok.hidden = true;
} else {
  missing.hidden = true;
  ok.hidden = false;
  void (async () => {
    const title = document.getElementById("group-title");
    const crumb = document.getElementById("group-crumb-name");
    const label = code ?? id;
    const short = label.length > 8 ? `${label.slice(0, 8)}…` : label;
    if (title) title.textContent = `Group ${short}`;
    if (crumb) crumb.textContent = short;

    try {
      const btnLogout = document.getElementById("btn-logout");
      const btnAddPlayer = document.getElementById("btn-add-player");
      const btnAddNight = document.getElementById("btn-add-night");

      // Resolve group and ensure login once per tab.
      const resolved = code ? await loadDashboardByCode(code) : await loadDashboardById(id);
      const groupId = resolved.group.id;
      const groupCode = resolved.group.code;
      if (btnLogout) {
        btnLogout.addEventListener("click", () => {
          clearSessionToken(groupId);
          window.location.assign("./index.html");
        });
      }

      await ensureLoggedIn({ groupId, groupCode });

      const refresh = async () => {
        const data = await loadDashboardById(groupId);
        if (title) title.textContent = data.group.name;
        if (crumb) crumb.textContent = data.group.name;
        renderPlayersList(data.players);
        renderNightsList(data.group.id, data.nights);
        renderLeaderboard({ players: data.players, results: data.results });
      };

      if (btnAddPlayer) {
        btnAddPlayer.addEventListener("click", async () => {
          try {
            const token = getSessionToken(groupId) ?? (await ensureLoggedIn({ groupId, groupCode }));
            await createPlayer(groupId, token);
            await refresh();
          } catch (err) {
            alert(`Could not add player: ${err?.message ?? err}`);
          }
        });
      }

      if (btnAddNight) {
        btnAddNight.addEventListener("click", async () => {
          try {
            const token = getSessionToken(groupId) ?? (await ensureLoggedIn({ groupId, groupCode }));
            await createNight(groupId, token);
          } catch (err) {
            alert(`Could not add night: ${err?.message ?? err}`);
          }
        });
      }

      await refresh();

    } catch (err) {
      alert(`Could not load group: ${err?.message ?? err}`);
    }
  })();
}
