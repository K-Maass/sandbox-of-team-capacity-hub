const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/;
const BEARER_TOKEN_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i;
const KNOWN_TOKEN_PATTERN = /\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/i;
const CREDENTIAL_LABEL_PATTERN =
  "(?:api[_ -]?key|access[_ -]?token|service[-_ ]?role|authorization|password|secret|token|jwt)";
const CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
  `\\b${CREDENTIAL_LABEL_PATTERN}\\s*[:=]\\s*\\S+`,
  "i",
);
const CREDENTIAL_IS_PATTERN = new RegExp(
  `\\b${CREDENTIAL_LABEL_PATTERN}\\s+is\\s+[A-Za-z0-9._~+/=-]{8,}\\b`,
  "i",
);
const CAPACITY_TABLE_PATTERN = "(?:consultants|demands|allocations|availability_blocks)";
const SQL_PAYLOAD_PATTERNS = [
  /\bselect\s+1\b/i,
  new RegExp(
    `\\bselect\\s+(?:\\*|[A-Za-z_][A-Za-z0-9_]*(?:\\s*,\\s*[A-Za-z_][A-Za-z0-9_]*)*)\\s+from\\s+${CAPACITY_TABLE_PATTERN}\\b`,
    "i",
  ),
  /\binsert\s+into\s+[A-Za-z_][A-Za-z0-9_]*\b/i,
  /\bupdate\s+[A-Za-z_][A-Za-z0-9_]*\s+set\b/i,
  /\bdelete\s+from\s+[A-Za-z_][A-Za-z0-9_]*\b/i,
  /\b(?:alter|drop|truncate|create)\s+table\s+[A-Za-z_][A-Za-z0-9_]*\b/i,
  /\bgrant\s+select\s+on\s+[A-Za-z_][A-Za-z0-9_]*\b/i,
];

/**
 * Returns the only reasons allowed to short-circuit before the IBM provider.
 * This guard intentionally does not classify Capacity Hub product language.
 */
export function preProviderSecurityReason(message: string): "security_request" | null {
  const normalized = message.toLowerCase();
  const credentialAccess =
    /\b(?:reveal|show|disclose|tell|give|use|access|provide|send|store|expose|print|retrieve|what\s+is)\b[\s\S]{0,48}\b(?:your\s+|my\s+|the\s+)?(?:jwt|bearer\s+token|service[-\s]?role\s+key|api\s+key|access\s+token|secret|credential|password|IBM_SERVICES_API_KEY|IBM_ICA_API_KEY|SUPABASE_SERVICE_ROLE_KEY)\b(?:\s+(?:value|it|itself|please))?\s*[.!?]*$/i.test(
      normalized,
    );
  const sqlRequest =
    /\b(execute|run|write|generate|reveal)\b.{0,30}\bsql\b/.test(normalized) ||
    SQL_PAYLOAD_PATTERNS.some((pattern) => pattern.test(message));
  const confirmationBypass = /\b(skip|bypass|without)\b.{0,30}\bconfirm/.test(normalized);
  const pastedCredential =
    UUID_PATTERN.test(message) ||
    JWT_PATTERN.test(message) ||
    BEARER_TOKEN_PATTERN.test(message) ||
    KNOWN_TOKEN_PATTERN.test(message) ||
    CREDENTIAL_ASSIGNMENT_PATTERN.test(message) ||
    CREDENTIAL_IS_PATTERN.test(message);

  return credentialAccess || sqlRequest || confirmationBypass || pastedCredential
    ? "security_request"
    : null;
}
