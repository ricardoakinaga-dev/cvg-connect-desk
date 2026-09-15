/**
 * AAA-17 / C07 — redação determinística de identificadores diretos em cópias
 * textuais (content, payload, metadata, old/new values). A transformação é
 * idempotente: reexecutar não altera o texto já redigido.
 */

export interface DirectIdentifiers {
  phone: string;
  name: string;
  email: string;
  externalId: string;
}

export function identifierList(identifiers: Partial<DirectIdentifiers>): string[] {
  return [identifiers.phone, identifiers.name, identifiers.email, identifiers.externalId]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());
}

export function anonymizedMarker(contactId: string): string {
  return `ANONYMIZED-${contactId.slice(0, 8)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textContainsAny(value: string | null | undefined, identifiers: string[]): boolean {
  if (!value) return false;
  return identifiers.some((identifier) => {
    if (!identifier) return false;
    const escaped = escapeRegExp(identifier);
    const flags = /[A-Za-z]/.test(identifier) ? 'i' : '';
    return new RegExp(escaped, flags).test(value);
  });
}

export function redactText(
  value: string | null | undefined,
  identifiers: string[],
  marker: string,
): string | null {
  if (value === null || value === undefined) return null;
  let result = value;
  for (const identifier of identifiers) {
    if (!identifier) continue;
    const escaped = escapeRegExp(identifier);
    const flags = /[A-Za-z]/.test(identifier) ? 'gi' : 'g';
    result = result.replace(new RegExp(escaped, flags), marker);
  }
  return result;
}
