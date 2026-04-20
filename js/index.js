import { getSupabase } from "./supabase.js";
import { navigate } from "./url.js";

const formNew = document.getElementById("form-new-group");
const formOpen = document.getElementById("form-open-group");

async function smokeTestSupabase() {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.from("groups").select("id").limit(1);
    if (error) {
      console.warn("Supabase connected, but query failed:", error.message);
    } else {
      console.info("Supabase connected.");
    }
  } catch (err) {
    console.warn("Supabase not configured yet:", err?.message ?? err);
  }
}

smokeTestSupabase();

formNew?.addEventListener("submit", (e) => {
  e.preventDefault();
  void (async () => {
    const name = /** @type {HTMLInputElement | null} */ (
      document.getElementById("group-name")
    )?.value?.trim();
    const code = /** @type {HTMLInputElement | null} */ (
      document.getElementById("group-code")
    )?.value?.trim();
    const password = /** @type {HTMLInputElement | null} */ (
      document.getElementById("group-password")
    )?.value ?? "";

    if (!name) {
      alert("Please enter a group name.");
      return;
    }
    if (!code) {
      alert("Please choose a group code.");
      return;
    }
    if (!/^[a-z0-9]{3,32}$/.test(code)) {
      alert("Group code must be 3–32 characters: lowercase letters and numbers only.");
      return;
    }
    if (password.length < 4) {
      alert("Please use a group password of at least 4 characters.");
      return;
    }

    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.rpc("create_group", {
        group_name: name,
        group_code: code,
        group_password: password,
      });
      if (error) throw error;
      if (!data) throw new Error("No group id returned.");
      navigate("./group.html", { code });
    } catch (err) {
      alert(`Could not create group: ${err?.message ?? err}`);
    }
  })();
});

formOpen?.addEventListener("submit", () => {
  // native GET navigation to group.html?id=...
});
