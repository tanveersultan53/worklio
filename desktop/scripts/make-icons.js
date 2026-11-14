// @ts-check
"use strict";

/**
 * Builds every desktop icon from build/logo-mark.svg. Run with `npm run icons` (uses Electron's
 * Chromium to rasterise, so no image tools are needed). Writes:
 *   build/icon.icns        macOS app icon (Apple grid: 824px tile on 1024, soft shadow)  [macOS only, needs iconutil]
 *   build/icon.ico         Windows app + installer icon (16–256)
 *   build/icon.png         1024px source electron-builder falls back to
 *   build/icons/NxN.png    Linux icon theme sizes
 *   src/assets/icon.png    window icon (Linux) and dock icon when running from source
 *   src/assets/tray*.png   Windows/Linux tray icon, plain and with an unread dot (1x and 2x)
 *   src/ui/logo.png        logo on the setup / offline screens
 */
const { app } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mark = fs
  .readFileSync(path.join(root, "build", "logo-mark.svg"), "utf8")
  .replace(/<!--[\s\S]*?-->\s*/, "")
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");

/** The mark centred in a box: `size` px, placed at (x, y). */
const placeMark = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 128})">${mark}</g>`;

/**
 * App tile on a 1024 canvas. macOS: 824px squircle-ish tile with shadow, per Apple's grid.
 * Windows/Linux: nearly full-bleed rounded tile, no shadow (the OS adds its own chrome).
 */
function tileSvg({ inset, radius, shadow }) {
  const size = 1024 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1eef3"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" fill="url(#bg)" ${shadow ? 'filter="url(#shadow)"' : ""}/>
  <rect x="${inset + 1}" y="${inset + 1}" width="${size - 2}" height="${size - 2}" rx="${radius - 1}" fill="none" stroke="#3a1238" stroke-opacity="0.10" stroke-width="2"/>
  ${placeMark(inset + size * 0.06, inset + size * 0.05, size * 0.88)}
</svg>`;
}

/** Tray: just the mark, optionally with a red unread dot in the top-right corner. */
function traySvg(unread) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  ${placeMark(-6, -4, 140)}
  ${unread ? '<circle cx="104" cy="24" r="22" fill="#e5375f" stroke="#fff" stroke-width="8"/>' : ""}
</svg>`;
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const { BrowserWindow } = require("electron");
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL("data:text/html,<canvas></canvas>");

  /** @param {string} svg @param {number} px */
  const raster = async (svg, px) => {
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + ${JSON.stringify(Buffer.from(svg).toString("base64"))};
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = ${px};
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, ${px}, ${px});
      return c.toDataURL("image/png");
    })()`);
    return Buffer.from(dataUrl.split(",")[1], "base64");
  };
  /** @param {string} rel @param {Buffer} buf */
  const write = (rel, buf) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    console.log("wrote", rel);
  };

  const mac = tileSvg({ inset: 100, radius: 185, shadow: true });
  const flat = tileSvg({ inset: 24, radius: 200, shadow: false });

  // macOS .icns via iconutil.
  if (process.platform === "darwin") {
    const set = fs.mkdtempSync(path.join(os.tmpdir(), "worklio-icon-")) + "/icon.iconset";
    fs.mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      fs.writeFileSync(`${set}/icon_${s}x${s}.png`, await raster(mac, s));
      fs.writeFileSync(`${set}/icon_${s}x${s}@2x.png`, await raster(mac, s * 2));
    }
    execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(root, "build", "icon.icns")]);
    fs.rmSync(path.dirname(set), { recursive: true, force: true });
    console.log("wrote build/icon.icns");
  } else {
    console.log("skipped build/icon.icns (needs macOS iconutil)");
  }

  // Windows .ico: PNG-compressed entries, which every Windows since Vista reads.
  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const pngs = await Promise.all(icoSizes.map((s) => raster(flat, s)));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const e = 6 + i * 16;
    const s = icoSizes[i];
    header.writeUInt8(s >= 256 ? 0 : s, e);
    header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  write("build/icon.ico", Buffer.concat([header, ...pngs]));

  write("build/icon.png", await raster(mac, 1024));
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) write(`build/icons/${s}x${s}.png`, await raster(flat, s));
  write("src/assets/icon.png", await raster(flat, 512));
  write("src/assets/icon-mac.png", await raster(mac, 512));
  write("src/ui/logo.png", await raster(flat, 160));
  for (const [name, unread] of [["tray", false], ["tray-unread", true]]) {
    write(`src/assets/${name}.png`, await raster(traySvg(unread), 16));
    write(`src/assets/${name}@2x.png`, await raster(traySvg(unread), 32));
  }
  app.exit(0);
});
