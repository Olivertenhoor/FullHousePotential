# FullHousePotential

Static HTML app backed by Supabase.

## Local run

```bash
python3 -m http.server 5173
```

Open `http://localhost:5173/index.html`.

## Supabase setup

1. Copy config.

```bash
cp js/config.example.js js/config.js
```

2. Edit `js/config.js` and set:
- `supabaseUrl` (Project URL)
- `supabaseAnonKey` (Project API key: **anon public**)

3. In Supabase SQL editor, run `supabase/setup.sql`.

After that, “Create group” on the home page will create a row in `public.groups` via the `create_group(...)` RPC and redirect to `group.html?id=...`.
