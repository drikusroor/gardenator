import './style.css';
import { App } from './ui/app';

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) throw new Error('#app mount point missing');

// WebGL is the one hard requirement; fail with an explanation rather than a
// blank screen if the browser or driver cannot provide a context.
if (!hasWebGl()) {
  mount.innerHTML = `
    <div class="fatal">
      <h1>Gardenator heeft WebGL nodig</h1>
      <p>Deze browser kan geen 3D-weergave starten. Probeer een recente versie van
      Chrome, Edge, Firefox of Safari, en controleer of hardwareversnelling aanstaat.</p>
    </div>`;
} else {
  const app = new App(mount);
  window.addEventListener('beforeunload', () => app.savePreferences());
}

function hasWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
