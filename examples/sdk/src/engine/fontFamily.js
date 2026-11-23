/**
 * A font-family list made safe for the canvas `font` shorthand.
 *
 * The shorthand rejects the whole value when a family name is not a valid CSS identifier
 * sequence (for example `Font Awesome 5 Free`, whose `5` cannot start an identifier), and the
 * canvas silently keeps its previous font, so icons draw as empty boxes. Names that need it are
 * quoted; names that are already valid, already quoted, or generic keywords pass through as-is.
 */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'emoji', 'math', 'fangsong',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset']);
const IDENT = /^-?[_a-zA-Z\u00a0-\uffff][\w\u00a0-\uffff-]*$/;

function quoteOne(name) {
  const n = name.trim();
  if (!n || /^(['"]).*\1$/.test(n) || GENERIC.has(n.toLowerCase())) return n;
  if (n.split(/\s+/).every(token => IDENT.test(token))) return n;
  return `"${n.replace(/["\\]/g, '\\$&')}"`;
}

export function cssFontFamily(family) {
  if (!family) return 'sans-serif';
  // Split on commas outside quotes.
  return String(family).match(/(?:"[^"]*"|'[^']*'|[^,])+/g).map(quoteOne).join(', ');
}
