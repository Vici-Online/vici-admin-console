# admin-console

v1.0.0 is broken (manifest lacks `formatVersion`; install refuses it). Use v1.0.1+.

The Vici in-game admin console (F12): file browser, admin permissions, NPC tools.

## Install

From the VS Code extension (dev channel), as a devAdmin:

    packages.install {name: "admin-console", source: "https://github.com/Vici-Online/vici-admin-console", tag: "v1.0.1"}

The package registers its own root script (`_vpkg/admin-console/adminCore.ts`);
do not add it to `serverOptions.json`. Restart the server to load it.

The first player to log in on a server with no admins becomes superadmin
(`files:rw:/`).

## Requirements

- The host game ships `ViciDefaults/rml/utilities.rcss` and
  `ViciDefaults/fonts/{VT323,SourceCodePro}-Regular.ttf` (every game made from
  ViciDefaultAssets does).
- Tables `admin_users` and `admin_permissions` in the server db are owned by
  this package. Existing rows from a pre-package admin console are reused as-is.

## Migrating from the in-tree admin console

Remove `admin/adminCore.ts` from `rootScripts` in `serverOptions.json` (otherwise
admins get two consoles), then delete `scripts/serverside/admin/`, `scripts/clientside/admin/` and
`ViciDefaults/rml/admin/`. Chat commands that lived in the old `adminCore.ts`
are not part of this package; keep them in a game script that handles
`onPlayerChatsCommand`.
