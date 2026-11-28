export function isVideoSessionId(value) {
  return typeof value === 'string' && /^session_(?:\d{13}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(value);
}
