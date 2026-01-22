export const toStateCode = (value = '') => {
  if (!value) return '';
  const match = `${value}`.match(/([A-Z]{2})/i);
  return match ? match[1].toUpperCase() : '';
};

export const normalizeKey = (key = '') => `${key}`.trim().toLowerCase().replace(/\s+/g, '_');

export const escapeHTML = (value = '') => `${value}`
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(',', '');
};
