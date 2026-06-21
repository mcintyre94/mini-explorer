// Minimal HTML templating with escape-by-default. We stream with the sanitizer
// off, so a forgotten escape is an XSS / parser-break bug — this inverts the
// default: interpolations are escaped automatically, and trusted fragments must
// be marked raw() explicitly. Components return Html and nest freely; convert to
// a string with toHtml() at the response boundary. Plain TS — no build step.

const RAW = Symbol('raw');
export type Html = { readonly [RAW]: string };

const isHtml = (v: unknown): v is Html => typeof v === 'object' && v !== null && RAW in (v as object);

export const raw = (s: string): Html => ({ [RAW]: s });

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

// How a single interpolated value is serialized: Html → raw, array → joined,
// null/false/true → empty, everything else → escaped string.
const part = (v: unknown): string => {
  if (v == null || v === false || v === true) return '';
  if (isHtml(v)) return v[RAW];
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(String(v));
};

export function html(strings: TemplateStringsArray, ...vals: unknown[]): Html {
  let out = strings[0]!;
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1]!;
  return raw(out);
}

// Serialize a list with a trusted separator (default none). Array interpolation
// in html`` joins with no separator; use this when you want spaces/commas.
export const join = (items: unknown[], sep = ''): Html => raw(items.map(part).join(sep));

export const toHtml = (v: Html | string): string => (typeof v === 'string' ? v : v[RAW]);

// ---- Streaming scaffolding (processing instructions + patches) -------------
// Kept in one place so the markup quirks and the ordering invariant live here,
// not scattered through every component.
export const marker = (name: string): Html => raw(`<?marker name="${esc(name)}">`);
export const range = (name: string, placeholder: string): Html =>
  raw(`<?start name="${esc(name)}">${esc(placeholder)}<?end>`);
export const patch = (forName: string, body: Html): Html =>
  html`<template for="${forName}">${body}</template>`;
