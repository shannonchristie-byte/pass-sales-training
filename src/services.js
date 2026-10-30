/**
 * services.js — the services the sales team sells.
 *
 * One list, read by both halves. The knowledge base shows every service to
 * everybody. Training and development only opens a service's courses once
 * Shannon or Poppy has switched it on for that person, because people are
 * trained on one service at a time.
 *
 * MME is left out on purpose (Shannon, 28 Oct 2026). The online international
 * exams sit under Pass Learn, which sells them (Shannon, 30 Oct 2026); the key
 * stays 'exams' so nothing already switched on or done moves.
 *
 * Each logo is the brand's own, read straight from its website, so a new logo
 * there shows here without anybody copying files about. Access to HE has no
 * site of its own: it's sold through Pass Learn.
 */

const PL_LOGO = 'https://passlearn.co.uk/app/themes/complete-tuition-theme/dist/assets/svg/pl/logos/desktop-logo.svg';

export const SERVICES = [
  {
    key: 'pfs', name: 'Pass Functional Skills', short: 'PFS',
    logo: 'https://passfunctionalskills.co.uk/app/uploads/2025/03/pfs-logo-hoz@4x-4-300x39.png',
  },
  {
    key: 'astar', name: 'A Star Equivalency', short: 'A Star',
    logo: 'https://astarequivalency.co.uk/app/themes/complete-tuition-theme/dist/assets/img/logos/as/mobile-logo.webp',
  },
  {
    key: 'pmg', name: 'Pass GCSE', short: 'Pass GCSE',
    logo: 'https://passmygcse.co.uk/app/themes/complete-tuition-theme/dist/assets/svg/pmg/logos/desktop-logo.svg',
  },
  {
    key: 'alevel', name: 'Pass A Level', short: 'A Level',
    logo: 'https://passalevel.co.uk/app/themes/complete-tuition-theme/dist/assets/svg/pal/logos/desktop-logo.svg',
  },
  { key: 'access', name: 'Access to HE', short: 'Access', detail: 'Sold through Pass Learn', logo: PL_LOGO },
  { key: 'exams', name: 'Pass Learn', short: 'Pass Learn', detail: 'Online international exams', logo: PL_LOGO },
];

export const SERVICE_KEYS = SERVICES.map((s) => s.key);

export const isService = (key) => SERVICE_KEYS.includes(key);
