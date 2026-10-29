/**
 * icons.js — the icon set.
 *
 * SVG on a 24×24 viewBox, 2px outline, inheriting currentColor, from the Pass
 * design system's own icon files. There are no emoji anywhere in the app's
 * chrome any more: the design system is explicit that Pass UI does not use
 * them, and the old nav glyphs (★ ◧ ＋ ☰ ⚙) were exactly that.
 *
 * Substituted icons. The Pass set carries 27 outline files and the app needed
 * a few more, so these are drawn in the same 2px outline style after Lucide,
 * which is what the design system says to do when an icon is missing — and it
 * says to flag the substitution, so here it is:
 *
 *   star, plus, hourglass, calendar, upload, sun, history, key, power, grid, trophy, pound
 *
 * If the real Pass versions of any of these turn up, they drop straight in.
 */

const PATHS = {
  'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
  'award': '<circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>',
  'bell': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>',
  'calculator': '<rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="14" x2="16" y2="18"></line><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"></path>',
  'calendar': '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 11h18"></path>',
  'chart-bar': '<line x1="3" y1="20" x2="21" y2="20"></line><rect x="6" y="10" width="3" height="10"></rect><rect x="11" y="6" width="3" height="14"></rect><rect x="16" y="13" width="3" height="7"></rect>',
  'check': '<polyline points="20 6 9 17 4 12"></polyline>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
  'chevron-right': '<polyline points="9 6 15 12 9 18"></polyline>',
  'clipboard-list': '<rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M9 12h6M9 16h6M9 8h.01"></path>',
  'clock': '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>',
  'graduation-cap': '<path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path>',
  'grid': '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
  'history': '<path d="M4 4v5h5"></path><path d="M4.6 12a8 8 0 1 0 2.3-5.7L4 9"></path><path d="M12 8v4l3 2"></path>',
  'home': '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"></path>',
  'hourglass': '<path d="M7 3h10M7 21h10M7 3v3a5 5 0 0 0 5 5 5 5 0 0 0 5-5V3M7 21v-3a5 5 0 0 1 5-5 5 5 0 0 1 5 5v3"></path>',
  'key': '<circle cx="8" cy="15" r="4"></circle><path d="M10.8 12.2L20 3M17 6l3 3M14 9l3 3"></path>',
  'lightbulb': '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.7.6 1 1.5 1 2.3h6c0-.8.3-1.7 1-2.3A7 7 0 0 0 12 2z"></path>',
  'menu': '<line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line>',
  'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>',
  'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>',
  'play': '<polygon points="5 3 19 12 5 21 5 3"></polygon>',
  'plus': '<path d="M12 5v14M5 12h14"></path>',
  'pound': '<path d="M16 5.5A3.5 3.5 0 0 0 9 6.6V11h5M7 14h9M7 19h10a4 4 0 0 1-2-3.4V11"></path>',
  'power': '<path d="M12 3v9"></path><path d="M18.4 6.6a9 9 0 1 1-12.8 0"></path>',
  'search': '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
  'settings': '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
  'sparkles': '<path d="M12 3 13.9 8.1 19 10 13.9 11.9 12 17 10.1 11.9 5 10 10.1 8.1z"></path><path d="M19 17v4M17 19h4M5 3v4M3 5h4"></path>',
  'star': '<path d="M12 2.5l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.5 9.4l6.6-1z"></path>',
  'sun': '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>',
  'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>',
  'trophy': '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"></path><path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5c0 2 1.5 3.5 4 3.5M17 6h2.5A1.5 1.5 0 0 1 21 7.5c0 2-1.5 3.5-4 3.5"></path>',
  'upload': '<path d="M12 16V4M7 9l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>',
  'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
  'users': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
};

/**
 * One icon as an SVG string.
 *
 * Returns nothing at all for an unknown name rather than a broken glyph or a
 * placeholder box — a missing icon should be invisible, not wrong.
 */
export function icon(name, { size = null, className = '' } = {}) {
  const path = PATHS[name];
  if (!path) return '';
  const cls = ['icon', size === 'sm' ? 'icon-sm' : size === 'lg' ? 'icon-lg' : '', className]
    .filter(Boolean).join(' ');
  return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
}

export const ICON_NAMES = Object.keys(PATHS);
export const SUBSTITUTED = ["star","plus","hourglass","calendar","upload","sun","history","key","power","grid","trophy","pound"];
