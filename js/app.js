// App shell: hash router, bottom nav, greeting.
import { initProfile, profileGreetingName } from './profile.js';
import { loadProfile, isProfileComplete } from './store.js';

const ROUTES = {
  today: { title: 'Today' },
  tracker: { title: 'Tracker' },
  profile: { title: 'Profile' },
};

let firstRender = true;

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (ROUTES[name]) return name;
  // First visit (or unfinished profile) starts on Profile.
  return isProfileComplete(loadProfile()) ? 'today' : 'profile';
}

function render() {
  const route = currentRoute();
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.dataset.route !== route));
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${ROUTES[route].title} · Job Finder`;
  if (route === 'today') renderGreeting();

  if (!firstRender) {
    window.scrollTo(0, 0);
    // Move focus to the new screen's heading for screen-reader users.
    const h1 = document.querySelector(`[data-route="${route}"] h1`);
    if (h1) {
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
  }
  firstRender = false;
}

export function greeting(date = new Date(), name = '') {
  const h = date.getHours();
  const part = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${part}${name ? `, ${name}` : ''}`;
}

function renderGreeting() {
  document.querySelector('[data-greeting]').textContent = greeting(new Date(), profileGreetingName());
}

initProfile({ onDone: () => (location.hash = '#/today') });
window.addEventListener('hashchange', render);
render();
