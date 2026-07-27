import fs from "node:fs/promises";
import path from "node:path";

const vaultPath = process.argv[2] || process.env.OBSIDIAN_VAULT;

if (!vaultPath) {
    console.error(
        "Usage: npm run install-local -- /path/to/YourVault\n" +
            "   or: OBSIDIAN_VAULT=/path/to/YourVault npm run install-local"
    );
    process.exit(1);
}

const pluginId = "d6-dice-roller";
const pluginDir = path.join(vaultPath, ".obsidian", "plugins", pluginId);
const files = ["main.js", "manifest.json", "styles.css"];

await fs.mkdir(pluginDir, { recursive: true });

for (const file of files) {
    await fs.copyFile(file, path.join(pluginDir, file));
}

console.log(`Installed ${pluginId} to ${pluginDir}`);
