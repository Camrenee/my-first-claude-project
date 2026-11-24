// A short message at the bottom of the screen, also read out to screen readers.
let timer;

export function toast(text) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('aria-hidden', 'true'); // the live region below announces it
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.add('is-on');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('is-on'), 2600);

  const live = document.getElementById('app-live');
  if (live) {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  }
}
