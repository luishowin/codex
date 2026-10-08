// ⌘⇧3: the shutter sound and the screen flash, like a real screenshot.
import { el } from '../core/util.js';
import { screenshot } from '../core/sfx.js';

/** Play the camera shutter, flash the screen, then leave a file on the Desktop. */
export function takeScreenshot() {
  screenshot();
  flash();
  saveShot();
}

function flash() {
  const f = el('div.shot-flash');
  document.getElementById('overlays').append(f);
  setTimeout(() => f.remove(), 420);
}

function saveShot() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const name = `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.png`;
  import('../core/fs.js').then(async fs => {
    const folder = fs.HOME + '/Desktop/Screenshots';
    if (!fs.get(folder)) fs.mkdir(fs.HOME + '/Desktop', 'Screenshots');
    fs.createFile(folder, name, 'Screenshot captured at ' + d.toLocaleTimeString() + '.\n');
    const { notify } = await import('./notify.js');
    notify('Screenshot', `Saved to Desktop/Screenshots/${name}`);
  });
}
