import { el, mount } from '../ui.js';

export function render(root) {
  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '← Back', attrs: { href: '#home' } }),
    ]),
    el('section', { className: 'card' }, [
      el('h1', { className: 'page-title', text: 'Credits & sources' }),
      el('p', { className: 'muted-note', text: 'Where the data and the pictures come from.' }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Player data' }),
      el('p', {
        className: 'muted-note',
        text: 'The football facts — names, dates of birth, nationalities, positions, club careers, appearances, goals and market values — come from the CC0 transfermarkt-datasets project by David Cariboo.',
      }),
      el('a', {
        className: 'muted-note',
        text: 'github.com/dcaribou/transfermarkt-datasets',
        attrs: {
          href: 'https://github.com/dcaribou/transfermarkt-datasets',
          target: '_blank',
          rel: 'noreferrer',
        },
      }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Tournament squads' }),
      el('p', {
        className: 'muted-note',
        text: 'Tournament rosters come from Wikidata — players recorded as participants in, or members of a participating nation’s squad during, each tournament.',
      }),
      el('a', {
        className: 'muted-note',
        text: 'wikidata.org',
        attrs: { href: 'https://www.wikidata.org', target: '_blank', rel: 'noreferrer' },
      }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Photos' }),
      el('p', {
        className: 'muted-note',
        text: 'Player photos come from Wikimedia Commons and are used under the licence listed against each file — usually CC BY-SA 4.0, sometimes CC0 or public domain. Every photo carries its own author attribution.',
      }),
      el('a', {
        className: 'muted-note',
        text: 'commons.wikimedia.org',
        attrs: { href: 'https://commons.wikimedia.org', target: '_blank', rel: 'noreferrer' },
      }),
      el('p', {
        className: 'muted-note',
        text: 'A player with no freely-licensed photo gets a jersey tile instead — their initials on a colour picked from their id, so it is always the same one.',
      }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Fonts' }),
      el('p', {
        className: 'muted-note',
        text: 'Fredoka and Playfair Display for headings, Inter for everything else.',
      }),
    ]),
  ]);
}
