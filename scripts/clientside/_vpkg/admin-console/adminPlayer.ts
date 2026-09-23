// Admin Console — Client Script
// Equipped on admin players. Manages the admin console UI.

let adminDoc: RmlDocument | null = null;
let adminOpen: boolean = false;
let isAdmin: boolean = false;

// Drag state
let dragging: boolean = false;
let dragStartX: number = 0;
let dragStartY: number = 0;
let dragStartLeft: number = 0;
let dragStartTop: number = 0;

// Resize state
let resizing: boolean = false;
let resizeStartX: number = 0;
let resizeStartY: number = 0;
let resizeStartW: number = 0;
let resizeStartH: number = 0;

const MIN_WIDTH: number = 200;
const MIN_HEIGHT: number = 150;

let pendingCenter: boolean = false;

// Tab system
let activeTab: string = "chat";

// Chat state (client-local, not persisted)
let chatMessages: { sender: string; text: string }[] = [];

// File browser state
let currentPath: string = "/";
let filePermissions: string[] = [];
let fileEntries: { name: string; isDirectory: boolean; size: number }[] = [];
let filesInitialized: boolean = false;

// Permissions management state
let permsUsers: { username: string; permissions: string[] }[] = [];
let permsInitialized: boolean = false;

// --- Lifecycle ---

function onLoad(): void {
    // Wait for adminInit trigger from server
}

function onUnload(): void {
    closeConsole();
}

// Edge-triggered lifecycle hook: the engine fires this once on the frame F12
// goes down, and never misses a fast press+release (it latches the edge until
// the frame's scripts have run). Replaces the old prevF12 hand-roll in
// onUpdate.
function onKeyPressed(key: string): void {
    if (key === "f12") {
        if (adminOpen) {
            closeConsole();
        } else {
            openConsole();
        }
    }
}

function onUpdate(): void {
    // Deferred centering — wait one frame for RmlUI layout
    if (pendingCenter && adminDoc) {
        const win = adminDoc.getElementById("adminWindow");
        if (win && win.offsetWidth > 0) {
            const docW: number = getScreenWidth();
            const docH: number = getScreenHeight();
            const centerX: number = (docW - win.offsetWidth) / 2;
            const centerY: number = (docH - win.offsetHeight) / 2;
            win.setProperty("left", (centerX > 0 ? centerX : 0) + "dp");
            win.setProperty("top", (centerY > 0 ? centerY : 0) + "dp");
            pendingCenter = false;
        }
    }

    // Poll mouse state for drag/resize (bypasses RmlUI hit-testing)
    const win: RmlElement | null = adminDoc ? adminDoc.getElementById("adminWindow") : null;
    if (win && (dragging || resizing)) {
        if (!isMouseButtonDown("Left")) {
            dragging = false;
            resizing = false;
            return;
        }
        const mx: number = getMouseX();
        const my: number = getMouseY();
        if (dragging) {
            const dx: number = mx - dragStartX;
            const dy: number = my - dragStartY;
            win.setProperty("left", (dragStartLeft + dx) + "dp");
            win.setProperty("top", (dragStartTop + dy) + "dp");
        }
        if (resizing) {
            const dx: number = mx - resizeStartX;
            const dy: number = my - resizeStartY;
            let newW: number = resizeStartW + dx;
            let newH: number = resizeStartH + dy;
            if (newW < MIN_WIDTH) newW = MIN_WIDTH;
            if (newH < MIN_HEIGHT) newH = MIN_HEIGHT;
            win.setProperty("width", newW + "dp");
            win.setProperty("height", newH + "dp");
        }
    }
}

// --- Console Management ---

function openConsole(): void {
    if (adminOpen || !isAdmin) return;
    adminOpen = true;

    rml.loadDocument("_vpkg/admin-console/shell.rml").then((doc: RmlDocument) => {
        adminDoc = doc;

        const win: RmlElement | null = doc.getElementById("adminWindow");

        // Defer centering to next onUpdate() so RmlUI has completed layout
        pendingCenter = true;

        // Close button
        const closeBtn: RmlElement | null = doc.getElementById("adminCloseBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                closeConsole();
            });
        }

        // Drag handle (title text)
        const dragHandle: RmlElement | null = doc.getElementById("adminDragHandle");
        if (dragHandle && win) {
            dragHandle.addEventListener("mousedown", () => {
                dragging = true;
                dragStartX = getMouseX();
                dragStartY = getMouseY();
                dragStartLeft = win.offsetLeft;
                dragStartTop = win.offsetTop;
            });
        }

        // Resize handle
        const handle: RmlElement | null = doc.getElementById("resizeHandle");
        if (handle && win) {
            handle.addEventListener("mousedown", () => {
                resizing = true;
                resizeStartX = getMouseX();
                resizeStartY = getMouseY();
                resizeStartW = win.offsetWidth;
                resizeStartH = win.offsetHeight;
            });
        }

        // Tab buttons
        setupTabs(doc);

        // Chat UI
        setupChat(doc);

        // Files UI
        setupFiles(doc);

        // Permissions UI
        setupPermissions(doc);

        // Render any existing messages
        renderChatMessages();
    });
}

function closeConsole(): void {
    if (adminDoc) {
        adminDoc.close();
        adminDoc = null;
    }
    adminOpen = false;
    dragging = false;
    resizing = false;
}

// --- Tab System ---

function setupTabs(doc: RmlDocument): void {
    const tabs: string[] = ["chat", "files", "permissions"];
    for (let i: number = 0; i < tabs.length; i++) {
        const tabId: string = tabs[i];
        const btn: RmlElement | null = doc.getElementById("tab-" + tabId);
        if (btn) {
            btn.addEventListener("click", () => {
                switchTab(tabId);
            });
        }
    }
}

function switchTab(tabId: string): void {
    if (!adminDoc || tabId === activeTab) return;
    activeTab = tabId;

    // Update tab button styles
    const tabs: string[] = ["chat", "files", "permissions"];
    for (let i: number = 0; i < tabs.length; i++) {
        const btn: RmlElement | null = adminDoc.getElementById("tab-" + tabs[i]);
        const content: RmlElement | null = adminDoc.getElementById("content-" + tabs[i]);
        if (btn) {
            btn.className = tabs[i] === tabId ? "admin-tab-active" : "admin-tab";
        }
        if (content) {
            content.setProperty("display", tabs[i] === tabId ? "flex" : "none");
        }
    }

    // Lazy-load files on first switch
    if (tabId === "files" && !filesInitialized) {
        filesInitialized = true;
        triggerServer("adminFilesListDir", currentPath);
    }

    // Lazy-load permissions on first switch
    if (tabId === "permissions" && !permsInitialized) {
        permsInitialized = true;
        triggerServer("adminPermsListUsers");
    }
}

// --- Chat ---

function setupChat(doc: RmlDocument): void {
    const sendBtn: RmlElement | null = doc.getElementById("chatSendBtn");
    const chatInput: RmlElement | null = doc.getElementById("chatInput");

    if (sendBtn) {
        sendBtn.addEventListener("click", () => {
            sendChatMessage();
        });
    }

    if (chatInput) {
        chatInput.addEventListener("keydown", (ev: RmlEvent) => {
            // RmlUI KI_RETURN = 72
            if (ev.keyIdentifier === 72) {
                sendChatMessage();
            }
        });
    }
}

function sendChatMessage(): void {
    if (!adminDoc) return;
    const chatInput: RmlElement | null = adminDoc.getElementById("chatInput");
    if (!chatInput) return;
    const text: string = chatInput.getAttribute("value") || "";
    if (text.trim().length === 0) return;
    if (handleNpcCommand(text.trim())) {
        chatInput.setAttribute("value", "");
        return;
    }
    triggerServer("adminSendChat", text);
    chatInput.setAttribute("value", "");
}

// --- /npc Console Commands ---
// Intercepts `/npc count [map]`, `/npc list [map]`, `/npc despawn <id>`.
// Returns true if the text was a /npc command (handled); false otherwise so
// normal chat dispatch continues. Bad operator input never throws — it echoes
// a usage line into the console instead.

function appendConsoleLine(text: string): void {
    chatMessages.push({ sender: "[npc]", text: text });
    renderChatMessages();
}

function npcUsage(): void {
    appendConsoleLine("usage: /npc count [map] | /npc list [map] | /npc despawn <id>");
}

function handleNpcCommand(text: string): boolean {
    if (text !== "/npc" && text.indexOf("/npc ") !== 0) return false;

    // Split on whitespace, dropping empty tokens from extra spaces.
    const rawParts: string[] = text.split(" ");
    const parts: string[] = [];
    for (let i: number = 0; i < rawParts.length; i++) {
        if (rawParts[i].length > 0) parts.push(rawParts[i]);
    }
    // parts[0] === "/npc"
    const sub: string = parts.length > 1 ? parts[1].toLowerCase() : "";
    const arg: string = parts.length > 2 ? parts[2] : "";

    if (sub === "count") {
        triggerServer("adminNpcCount", arg);
    } else if (sub === "list") {
        triggerServer("adminNpcList", arg);
    } else if (sub === "despawn") {
        if (arg.length === 0) {
            appendConsoleLine("usage: /npc despawn <id>");
        } else {
            triggerServer("adminNpcDespawn", arg);
        }
    } else {
        npcUsage();
    }
    return true;
}

function escapeRml(text: string): string {
    let result: string = "";
    for (let i: number = 0; i < text.length; i++) {
        const ch: string = text.charAt(i);
        if (ch === "<") result += "&lt;";
        else if (ch === ">") result += "&gt;";
        else if (ch === "&") result += "&amp;";
        else result += ch;
    }
    return result;
}

function renderChatMessages(): void {
    if (!adminDoc) return;
    const container: RmlElement | null = adminDoc.getElementById("chatMessages");
    if (!container) return;

    let rmlStr: string = "";
    for (let i: number = 0; i < chatMessages.length; i++) {
        const msg = chatMessages[i];
        rmlStr += '<div><span class="admin-chat-sender">'
            + escapeRml(msg.sender) + ':</span> <span class="admin-chat-text">'
            + escapeRml(msg.text) + '</span></div>';
    }
    container.innerRML = rmlStr;

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// --- File Browser ---

function setupFiles(doc: RmlDocument): void {
    const backBtn: RmlElement | null = doc.getElementById("filesBackBtn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            navigateBack();
        });
    }

    const uploadBtn: RmlElement | null = doc.getElementById("filesUploadBtn");
    if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
            uploadFile();
        });
    }
}

function getFileIcon(name: string, isDirectory: boolean): string {
    if (isDirectory) return "icons/admin-icon-folder.png";
    const lower: string = name.toLowerCase();
    if (lower.endsWith(".ts") || lower.endsWith(".js")) return "icons/admin-icon-file-script.png";
    if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") ||
        lower.endsWith(".gif") || lower.endsWith(".bmp")) return "icons/admin-icon-file-image.png";
    return "icons/admin-icon-file.png";
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.floor(bytes / 1024) + " KB";
    return (Math.floor(bytes / 1024 / 1024 * 10) / 10) + " MB";
}

function renderFileList(): void {
    if (!adminDoc) return;
    const container: RmlElement | null = adminDoc.getElementById("filesList");
    if (!container) return;

    let rmlStr: string = "";

    // Sort: directories first, then files, alphabetical
    const dirs: { name: string; isDirectory: boolean; size: number }[] = [];
    const files: { name: string; isDirectory: boolean; size: number }[] = [];
    for (let i: number = 0; i < fileEntries.length; i++) {
        if (fileEntries[i].isDirectory) dirs.push(fileEntries[i]);
        else files.push(fileEntries[i]);
    }
    dirs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const sorted = dirs.concat(files);

    for (let i: number = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const icon: string = getFileIcon(entry.name, entry.isDirectory);
        const nameClass: string = entry.isDirectory ? "admin-files-name-dir" : "admin-files-name";
        const sizeStr: string = entry.isDirectory ? "" : formatSize(entry.size);

        rmlStr += '<div id="file-row-' + i + '" class="admin-files-row">'
            + '<img class="admin-files-icon" src="' + icon + '" />'
            + '<span class="' + nameClass + '">' + escapeRml(entry.name) + '</span>';
        if (!entry.isDirectory) {
            rmlStr += '<span class="admin-files-size">' + sizeStr + '</span>';
        }
        rmlStr += '</div>';
    }

    if (sorted.length === 0) {
        rmlStr = '<div class="admin-files-row"><span class="admin-files-name" style="color: #8A6040;">Empty directory</span></div>';
    }

    container.innerRML = rmlStr;

    // Attach click listeners
    for (let i: number = 0; i < sorted.length; i++) {
        const idx: number = i;
        const row: RmlElement | null = adminDoc.getElementById("file-row-" + i);
        if (row) {
            row.addEventListener("click", () => {
                onFileRowClick(sorted[idx]);
            });
        }
    }

    // Update path display
    renderBreadcrumb();
    setFilesStatus(sorted.length + " items");
}

function renderBreadcrumb(): void {
    if (!adminDoc) return;
    const pathEl: RmlElement | null = adminDoc.getElementById("filesPath");
    if (!pathEl) return;

    const parts: string[] = currentPath.split("/");
    let rmlStr: string = '<span class="admin-files-path">/</span>';

    let builtPath: string = "";
    for (let i: number = 0; i < parts.length; i++) {
        if (parts[i].length === 0) continue;
        builtPath += "/" + parts[i];
        rmlStr += '<span class="admin-files-path">' + escapeRml(parts[i]) + '/</span>';
    }

    pathEl.innerRML = rmlStr;
}

function onFileRowClick(entry: { name: string; isDirectory: boolean; size: number }): void {
    if (entry.isDirectory) {
        navigateTo(entry.name);
    } else {
        downloadFile(entry.name);
    }
}

function navigateTo(dirName: string): void {
    let newPath: string = currentPath;
    if (!newPath.endsWith("/")) newPath += "/";
    newPath += dirName;
    currentPath = newPath;
    setFilesStatus("Loading...");
    triggerServer("adminFilesListDir", currentPath);
}

function navigateBack(): void {
    if (currentPath === "/" || currentPath === "") return;
    const lastSlash: number = currentPath.lastIndexOf("/");
    if (lastSlash <= 0) {
        currentPath = "/";
    } else {
        currentPath = currentPath.substring(0, lastSlash);
    }
    setFilesStatus("Loading...");
    triggerServer("adminFilesListDir", currentPath);
}

function downloadFile(fileName: string): void {
    let fullPath: string = currentPath;
    if (!fullPath.endsWith("/")) fullPath += "/";
    fullPath += fileName;
    setFilesStatus("Downloading " + fileName + "...");
    triggerServer("adminFilesReadFile", fullPath);
}

function uploadFile(): void {
    const result = pickFile("All files", "*");
    if (!result) {
        setFilesStatus("Upload cancelled.");
        return;
    }
    setFilesStatus("Uploading " + result.name + "...");
    triggerServer("adminFilesWriteFile", currentPath, result.name, result.base64);
}

function setFilesStatus(msg: string): void {
    if (!adminDoc) return;
    const status: RmlElement | null = adminDoc.getElementById("filesStatus");
    if (status) {
        status.innerRML = escapeRml(msg);
    }
}

// --- Permissions Management ---

function setupPermissions(doc: RmlDocument): void {
    const refreshBtn: RmlElement | null = doc.getElementById("permsRefreshBtn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            triggerServer("adminPermsListUsers");
        });
    }

    const grantBtn: RmlElement | null = doc.getElementById("permsGrantBtn");
    if (grantBtn) {
        grantBtn.addEventListener("click", () => {
            grantPermission();
        });
    }
}

function grantPermission(): void {
    if (!adminDoc) return;
    const userInput: RmlElement | null = adminDoc.getElementById("permsUserInput");
    const permInput: RmlElement | null = adminDoc.getElementById("permsPermInput");
    if (!userInput || !permInput) return;

    const username: string = (userInput.getAttribute("value") || "").trim();
    const perm: string = (permInput.getAttribute("value") || "").trim();
    if (username.length === 0 || perm.length === 0) return;

    triggerServer("adminPermsGrant", username, perm);
    userInput.setAttribute("value", "");
    permInput.setAttribute("value", "");
}

function renderPermsList(): void {
    if (!adminDoc) return;
    const container: RmlElement | null = adminDoc.getElementById("permsList");
    if (!container) return;

    let rmlStr: string = "";
    let btnIdx: number = 0;

    for (let u: number = 0; u < permsUsers.length; u++) {
        const user = permsUsers[u];
        rmlStr += '<div class="admin-perms-user">' + escapeRml(user.username) + '</div>';

        if (user.permissions.length === 0) {
            rmlStr += '<div class="admin-perms-entry"><span class="admin-perms-perm" style="color: #8A6040;">No permissions</span></div>';
        }

        for (let p: number = 0; p < user.permissions.length; p++) {
            const perm: string = user.permissions[p];
            rmlStr += '<div class="admin-perms-entry">'
                + '<span class="admin-perms-perm">' + escapeRml(perm) + '</span>'
                + '<button id="revoke-btn-' + btnIdx + '" class="admin-perms-revoke-btn">X</button>'
                + '</div>';
            btnIdx++;
        }
    }

    container.innerRML = rmlStr;

    // Attach revoke click listeners
    btnIdx = 0;
    for (let u: number = 0; u < permsUsers.length; u++) {
        const user = permsUsers[u];
        for (let p: number = 0; p < user.permissions.length; p++) {
            const username: string = user.username;
            const perm: string = user.permissions[p];
            const btn: RmlElement | null = adminDoc.getElementById("revoke-btn-" + btnIdx);
            if (btn) {
                btn.addEventListener("click", () => {
                    triggerServer("adminPermsRevoke", username, perm);
                });
            }
            btnIdx++;
        }
    }
}

// --- Server Trigger Handlers ---

/** @trigger */
function adminInit(): void {
    isAdmin = true;
    console.log("[Admin] Console ready. Press F12 to toggle.");
}

/** @trigger */
function adminChatReceive(sender: string, text: string): void {
    chatMessages.push({ sender: sender, text: text });
    renderChatMessages();
}

/** @trigger */
function adminFilesPermissions(json: string): void {
    filePermissions = JSON.parse(json);
}

function adminFilesListResult(path: string, entriesJson: string): void {
    currentPath = path;
    fileEntries = JSON.parse(entriesJson);
    renderFileList();
}

function adminFilesReadResult(path: string, fileName: string, base64data: string): void {
    if (!base64data || base64data.length === 0) {
        setFilesStatus("Failed to download " + fileName);
        return;
    }
    const success: boolean = saveFile(fileName, base64data);
    if (success) {
        setFilesStatus("Saved " + fileName);
    } else {
        setFilesStatus("Save cancelled or failed for " + fileName);
    }
}

function adminFilesWriteResult(path: string, success: boolean): void {
    if (success) {
        setFilesStatus("Upload complete.");
        triggerServer("adminFilesListDir", currentPath);
    } else {
        setFilesStatus("Upload failed — check permissions.");
    }
}

function adminPermsListResult(json: string): void {
    permsUsers = JSON.parse(json);
    renderPermsList();
}

// --- NPC Console Result Handlers ---

/** @trigger */
function adminNpcDenied(msg: string): void {
    appendConsoleLine(msg);
}

/** @trigger */
function adminNpcCountResult(json: string): void {
    const data: { total: number; byMap: Record<string, number> } = JSON.parse(json);
    const maps: string[] = Object.keys(data.byMap);
    let detail: string = "";
    for (let i: number = 0; i < maps.length; i++) {
        if (detail.length > 0) detail += ", ";
        detail += maps[i] + ": " + data.byMap[maps[i]];
    }
    let line: string = data.total + " NPCs";
    if (detail.length > 0) line += " (" + detail + ")";
    appendConsoleLine(line);
}

// Client-side shape of a serialized server NpcSummary row (the `NpcSummary`
// interface itself is server-only; we re-declare the fields we render).
interface NpcListRow {
    id: number;
    map: string;
    x: number;
    y: number;
    dir: number;
    scripts: string[];
    hibernated: boolean;
    ageTicks: number;
    keepAlive: boolean;
    spawnedBy: string;
}

/** @trigger */
function adminNpcListResult(json: string): void {
    const rows: NpcListRow[] = JSON.parse(json);
    if (rows.length === 0) {
        appendConsoleLine("no NPCs");
        return;
    }
    for (let i: number = 0; i < rows.length; i++) {
        const r = rows[i];
        appendConsoleLine(
            r.id + "  " + r.map + " (" + r.x + "," + r.y + ")"
            + " scripts=[" + r.scripts.join(",") + "]"
            + " hib=" + r.hibernated
            + " by=" + r.spawnedBy);
    }
}

/** @trigger */
function adminNpcDespawnResult(json: string): void {
    const data: { ok: boolean; id: number | string } = JSON.parse(json);
    if (data.ok) {
        appendConsoleLine("despawned " + data.id);
    } else {
        appendConsoleLine("despawn: invalid id '" + data.id + "'");
    }
}
