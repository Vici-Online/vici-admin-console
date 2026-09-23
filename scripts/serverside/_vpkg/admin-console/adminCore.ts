// Admin Console — Root Script (server-side)
// Loaded at server startup. Creates DB tables and equips admin scripts on login.

// `dev.permissions` is installed by ServerScriptLoader::setupDevPermissionsApi
// before this script runs. There's no .d.ts for it yet, so we declare a loose
// shim here to keep editor tooling happy. Runtime access uses (dev as any).
declare const dev: any;

function onLoad(): void {
    console.log("[AdminCore] Initializing admin console...");

    db.exec(`CREATE TABLE IF NOT EXISTS admin_users (
        username TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS admin_permissions (
        username TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        granted_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (username, permission),
        FOREIGN KEY (username) REFERENCES admin_users(username) ON DELETE CASCADE
    )`).then(() => {
        console.log("[AdminCore] Admin tables ready.");
        replayPermissionsToEngine();
    });
}

// Replay admin_permissions into the engine on script boot.
// Each row's permission string ("files:read:/path/" or "files:rw:/path/") is
// parsed and applied via dev.permissions.grantUser. Unknown access tokens
// (e.g. legacy "files:write:") are skipped with a warn log.
function replayPermissionsToEngine(): void {
    db.query("SELECT username, permission FROM admin_permissions").then((rows: DbRow[]) => {
        const byUser: Record<string, { path: string; mode: string }[]> = {};
        for (let i: number = 0; i < rows.length; i++) {
            const username: string = rows[i].username as string;
            const permission: string = rows[i].permission as string;
            const parts: string[] = permission.split(":");
            if (parts.length < 3 || parts[0] !== "files") continue;
            const access: string = parts[1];
            const path: string = parts.slice(2).join(":");
            let mode: string;
            if (access === "read") {
                mode = "read";
            } else if (access === "rw") {
                mode = "rw";
            } else if (access === "write") {
                console.log("[AdminCore] ignoring legacy files:write: row for " + username + " (" + permission + ")");
                continue;
            } else {
                console.log("[AdminCore] unrecognized access '" + access + "' for " + username + " (" + permission + ")");
                continue;
            }
            if (!byUser[username]) byUser[username] = [];
            byUser[username].push({ path: path, mode: mode });
        }
        const usernames: string[] = Object.keys(byUser);
        for (let i: number = 0; i < usernames.length; i++) {
            const username: string = usernames[i];
            const entries = byUser[username];
            try {
                // bootReplay=true so [DevPerms] log lines are tagged accordingly.
                (dev as any).permissions.grantUser(username, entries, true);
            } catch (e) {
                console.log("[AdminCore] dev.permissions.grantUser failed for " + username + ": " + (e as Error).message);
            }
        }
        console.log("[AdminCore] Replayed permissions for " + usernames.length + " admin user(s) into engine.");
    });
}

// MUST return the promise chain. The server holds the player's initial-state
// packet until onPlayerLogin settles; a fire-and-forget `db.query(...).then(...)`
// returns void, the packet ships immediately, and any addScript that lands
// afterwards never reaches the client — the admin script silently never loads.
function onPlayerLogin(pl: ServerPlayer): Promise<void> {
    // Auto-promote first player as superadmin on fresh installs, then equip admin script.
    // addScript must happen after promotion so the admin player script sees the permissions.
    return db.query("SELECT COUNT(*) as cnt FROM admin_users").then((rows: DbRow[]) => {
        // Number() — cnt is typed string | number | null, and a driver that
        // hands back a string would make a strict `=== 0` silently skip promotion.
        if (rows.length > 0 && Number(rows[0].cnt) === 0) {
            console.log("[AdminCore] No admins exist — auto-promoting " + pl.username);
            return db.run("INSERT OR IGNORE INTO admin_users (username, created_by) VALUES (?, ?)", pl.username, "system")
                .then(() => {
                    return db.run("INSERT OR IGNORE INTO admin_permissions (username, permission, granted_by) VALUES (?, ?, ?)",
                        pl.username, "files:rw:/", "system");
                })
                .then(() => {
                    console.log("[AdminCore] Promotion complete, equipping admin script for " + pl.username);
                    // grantUser is otherwise only called from onLoad, so a player
                    // promoted at login had DB rows but no engine permission until
                    // the next reload — the table and the engine drifted apart.
                    replayPermissionsToEngine();
                    pl.addScript("_vpkg/admin-console/adminPlayer");
                });
        }
        // Only equip the admin script for actual admins — otherwise it runs
        // (and ships) to every player for nothing.
        return db.query("SELECT username FROM admin_users WHERE username = ? COLLATE NOCASE", pl.username)
            .then((adminRows: DbRow[]) => {
                if (adminRows.length > 0) pl.addScript("_vpkg/admin-console/adminPlayer");
            });
    });
}
