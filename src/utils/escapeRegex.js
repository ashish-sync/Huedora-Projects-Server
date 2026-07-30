/** Escape user input for safe use inside RegExp literals. */
export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function safeRegExp(value, flags = 'i') {
  return new RegExp(escapeRegex(value), flags);
}
