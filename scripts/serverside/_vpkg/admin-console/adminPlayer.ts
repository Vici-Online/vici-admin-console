// Admin Console — Equipped Script (server-side)
// Attached to each admin player. Confirms admin status to client.

// `dev.permissions` is installed by ServerScriptLoader::setupDevPermissionsApi
// before this script runs. There's no .d.ts for it yet, so we declare a loose
// shim here to keep editor tooling happy. Runtime access uses (dev as any).
declare const dev: any;

let cachedPermissions: string[] = [];

// --- Engine Mirror Helpers ---
// Mirror admin_permissions table mutations into the in-memory C++ permission
// store. Called after the DB write succeeds — never before, so a failed DB
// write cannot desynchronize state.

function syncEngineGrant(username: string, permString: string): void {
    const parts: string[] = permString.split(":");
    if (parts.length < 3 || parts[0] !== "files") return;
    const access: string = parts[1];
    const path: string = parts.slice(2).join(":");
    let mode: string;
    if (access === "read") {
        mode = "read";
    } else if (access === "rw") {
        mode = "rw";
    } else {
        console.log("[admin] syncEngineGrant: unsupported access '" + access + "'");
        return;
    }
    try {
        (dev as any).permissions.addEntry(username, { path: path, mode: mode });
    } catch (e) {
        console.log("[admin] dev.permissions.addEntry failed for " + username + ": " + (e as Error).message);
    }
}

function syncEngineRevoke(username: string, permString: string): void {
    const parts: string[] = permString.split(":");
    if (parts.length < 3 || parts[0] !== "files") return;
    const access: string = parts[1];
    const path: string = parts.slice(2).join(":");
    let mode: string;
    if (access === "read") {
        mode = "read";
    } else if (access === "rw") {
        mode = "rw";
    } else {
        return;
    }
    try {
        (dev as any).permissions.removeEntry(username, { path: path, mode: mode });
    } catch (e) {
        console.log("[admin] dev.permissions.removeEntry failed for " + username + ": " + (e as Error).message);
    }
}

function syncEngineRevokeAll(username: string): void {
    try {
        (dev as any).permissions.revokeUser(username);
    } catch (e) {
        console.log("[admin] dev.permissions.revokeUser failed for " + username + ": " + (e as Error).message);
    }
}

function onLoad(pl: ServerPlayer): void {
    db.query("SELECT username FROM admin_users WHERE username = ? COLLATE NOCASE", pl.username)
        .then((rows: DbRow[]) => {
            if (rows.length > 0) {
                loadPermissions().then(() => {
                    console.log("[AdminPlayer] Loaded " + cachedPermissions.length + " permissions for " + pl.username + ": " + JSON.stringify(cachedPermissions));
                    player.triggerClient("adminInit");
                    player.triggerClient("adminFilesPermissions", JSON.stringify(cachedPermissions));
                });
                console.log("[AdminPlayer] Admin confirmed: " + pl.username);
            } else {
                console.log("[AdminPlayer] Not an admin: " + pl.username);
            }
        });
}

function onUnload(pl: ServerPlayer): void {
}

// --- Permission Helpers ---

function loadPermissions(): Promise<void> {
    return db.query("SELECT permission FROM admin_permissions WHERE username = ? COLLATE NOCASE", player.username)
        .then((rows: DbRow[]) => {
            cachedPermissions = [];
            for (let i: number = 0; i < rows.length; i++) {
                cachedPermissions.push(rows[i].permission as string);
            }
        });
}

function parseFilePermission(perm: string): { access: string; path: string } | null {
    // Format: files:<access>:<path>
    if (!perm.startsWith("files:")) return null;
    const rest: string = perm.substring(6);
    const colonIdx: number = rest.indexOf(":");
    if (colonIdx < 0) return null;
    const access: string = rest.substring(0, colonIdx);
    const path: string = rest.substring(colonIdx + 1);
    if (access !== "read" && access !== "write" && access !== "rw") return null;
    return { access: access, path: path };
}

function checkFilePermission(path: string, mode: string): boolean {
    // mode is "read" or "write"
    let normPath: string = path;
    if (!normPath.startsWith("/")) normPath = "/" + normPath;
    if (!normPath.endsWith("/")) normPath = normPath + "/";

    for (let i: number = 0; i < cachedPermissions.length; i++) {
        const parsed = parseFilePermission(cachedPermissions[i]);
        if (!parsed) continue;

        let permPath: string = parsed.path;
        if (!permPath.endsWith("/")) permPath = permPath + "/";

        if (normPath.startsWith(permPath)) {
            if (mode === "read" && (parsed.access === "read" || parsed.access === "rw")) return true;
            if (mode === "write" && (parsed.access === "write" || parsed.access === "rw")) return true;
        }
    }
    return false;
}

function isPathVisible(path: string): boolean {
    let normPath: string = path;
    if (!normPath.startsWith("/")) normPath = "/" + normPath;
    if (!normPath.endsWith("/")) normPath = normPath + "/";

    for (let i: number = 0; i < cachedPermissions.length; i++) {
        const parsed = parseFilePermission(cachedPermissions[i]);
        if (!parsed) continue;

        let permPath: string = parsed.path;
        if (!permPath.endsWith("/")) permPath = permPath + "/";

        if (normPath.startsWith(permPath)) return true;
        if (permPath.startsWith(normPath)) return true;
    }
    return false;
}

// --- Chat ---

function adminSendChat(text: string): void {
    if (typeof text !== "string" || text.trim().length === 0) return;
    const msg: string = text.trim().substring(0, 500);
    const nickname: any = player.clientR?.nickname;
    const sender: string = (nickname && typeof nickname === "string")
        ? nickname : player.username;
    broadcastTrigger("adminChatReceive", sender, msg);
}

// --- File Browser Triggers ---

function adminFilesInit(): void {
    loadPermissions().then(() => {
        player.triggerClient("adminFilesPermissions", JSON.stringify(cachedPermissions));
    });
}

function adminFilesListDir(path: string): void {
    console.log("[AdminFiles] listDir path='" + path + "' perms=" + JSON.stringify(cachedPermissions));

    if (!checkFilePermission(path, "read") && !isPathVisible(path)) {
        console.log("[AdminFiles] Access denied for path: " + path);
        player.triggerClient("adminFilesListResult", path, "[]");
        return;
    }

    const entries: FileEntry[] = fs.listDir(path);
    console.log("[AdminFiles] fs.listDir returned " + entries.length + " entries for path='" + path + "'");
    const filtered: { name: string; isDirectory: boolean; size: number }[] = [];

    for (let i: number = 0; i < entries.length; i++) {
        const entry = entries[i];
        let entryPath: string = path;
        if (!entryPath.endsWith("/")) entryPath += "/";
        entryPath += entry.name;

        if (entry.isDirectory) {
            if (isPathVisible(entryPath)) {
                filtered.push({ name: entry.name, isDirectory: true, size: 0 });
            }
        } else {
            if (checkFilePermission(path, "read")) {
                filtered.push({ name: entry.name, isDirectory: false, size: entry.size });
            }
        }
    }

    console.log("[AdminFiles] Filtered to " + filtered.length + " entries");
    player.triggerClient("adminFilesListResult", path, JSON.stringify(filtered));
}

function adminFilesReadFile(path: string): void {
    const lastSlash: number = path.lastIndexOf("/");
    const dir: string = lastSlash > 0 ? path.substring(0, lastSlash) : "/";
    const fileName: string = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;

    if (!checkFilePermission(dir, "read")) {
        player.triggerClient("adminFilesReadResult", path, fileName, "");
        return;
    }

    const base64data: string = fs.readFile(path);
    player.triggerClient("adminFilesReadResult", path, fileName, base64data);
}

function adminFilesWriteFile(path: string, fileName: string, base64Content: string): void {
    if (!checkFilePermission(path, "write")) {
        player.triggerClient("adminFilesWriteResult", path, false);
        return;
    }

    let fullPath: string = path;
    if (!fullPath.endsWith("/")) fullPath += "/";
    fullPath += fileName;

    const success: boolean = fs.writeFile(fullPath, base64Content);
    player.triggerClient("adminFilesWriteResult", path, success);
}

// --- Permission Management Triggers ---

function adminPermsListUsers(): void {
    if (!checkFilePermission("/", "write")) return;

    db.query("SELECT u.username, GROUP_CONCAT(p.permission, '|') as perms FROM admin_users u LEFT JOIN admin_permissions p ON u.username = p.username GROUP BY u.username")
        .then((rows: DbRow[]) => {
            const users: { username: string; permissions: string[] }[] = [];
            for (let i: number = 0; i < rows.length; i++) {
                const permsStr: string = (rows[i].perms as string) || "";
                const permsList: string[] = permsStr.length > 0 ? permsStr.split("|") : [];
                users.push({ username: rows[i].username as string, permissions: permsList });
            }
            player.triggerClient("adminPermsListResult", JSON.stringify(users));
        });
}

function adminPermsGrant(targetUser: string, permission: string): void {
    if (!checkFilePermission("/", "write")) return;

    db.run("INSERT OR IGNORE INTO admin_permissions (username, permission, granted_by) VALUES (?, ?, ?)",
        targetUser, permission, player.username)
        .then(() => {
            syncEngineGrant(targetUser, permission);
            adminPermsListUsers();
        });
}

function adminPermsRevoke(targetUser: string, permission: string): void {
    if (!checkFilePermission("/", "write")) return;

    db.run("DELETE FROM admin_permissions WHERE username = ? COLLATE NOCASE AND permission = ?",
        targetUser, permission)
        .then(() => {
            syncEngineRevoke(targetUser, permission);
            adminPermsListUsers();
        });
}

// --- NPC Console Commands ---
// Superadmin-gated (the `files:rw:/` grant, same gate as perms management).
// Driven by the client console's `/npc count|list|despawn` chat commands.

function npcSuperadminDenied(): boolean {
    if (checkFilePermission("/", "write")) return false;
    player.triggerClient("adminNpcDenied", "permission denied: /npc requires superadmin (files:rw:/)");
    return true;
}

function adminNpcCount(arg?: string): void {
    if (npcSuperadminDenied()) return;
    const map: string = (typeof arg === "string") ? arg.trim() : "";
    const rows: NpcSummary[] = getNpcs(map.length > 0 ? { map: map } : undefined);
    const byMap: Record<string, number> = {};
    for (let i: number = 0; i < rows.length; i++) {
        const k: string = rows[i].map;
        byMap[k] = (byMap[k] || 0) + 1;
    }
    player.triggerClient("adminNpcCountResult", JSON.stringify({ total: rows.length, byMap: byMap }));
}

function adminNpcList(arg?: string): void {
    if (npcSuperadminDenied()) return;
    const map: string = (typeof arg === "string") ? arg.trim() : "";
    const rows: NpcSummary[] = getNpcs(map.length > 0 ? { map: map } : undefined);
    // Sort by spawnedBy so a leaking script's NPCs cluster together.
    rows.sort((a, b) => a.spawnedBy < b.spawnedBy ? -1 : a.spawnedBy > b.spawnedBy ? 1 : 0);
    player.triggerClient("adminNpcListResult", JSON.stringify(rows));
}

function adminNpcDespawn(idArg?: string): void {
    if (npcSuperadminDenied()) return;
    const id: number = Number(idArg);
    if (!isFinite(id) || id <= 0) {
        player.triggerClient("adminNpcDespawnResult", JSON.stringify({ ok: false, id: idArg }));
        return;
    }
    despawnNpc(id);
    player.triggerClient("adminNpcDespawnResult", JSON.stringify({ ok: true, id: id }));
}
