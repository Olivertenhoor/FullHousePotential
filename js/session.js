import { getSupabase } from "./supabase.js";

function key(groupId) {
  return `poker_session_${groupId}`;
}

export function getSessionToken(groupId) {
  return window.sessionStorage.getItem(key(groupId));
}

export function setSessionToken(groupId, token) {
  window.sessionStorage.setItem(key(groupId), token);
}

export function clearSessionToken(groupId) {
  window.sessionStorage.removeItem(key(groupId));
}

/**
 * Ensures the user has a session token for this group.
 * @param {{ groupId: string, groupCode?: string | null }} params
 */
export async function ensureLoggedIn({ groupId, groupCode }) {
  const existing = getSessionToken(groupId);
  if (existing) return existing;

  if (!groupCode) {
    throw new Error("Missing group code; cannot create a session.");
  }

  const password = window.prompt("Group password:");
  if (!password) throw new Error("Password required");

  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("create_group_session", {
    p_group_code: groupCode,
    p_password: password,
  });
  if (error) throw error;
  if (!data) throw new Error("No session token returned.");

  setSessionToken(groupId, String(data));
  return String(data);
}

