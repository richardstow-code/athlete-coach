// lib/suunto/jwt.js — decode a JWT payload WITHOUT verifying the signature.
//
// Suunto's token endpoint returns the access_token as a JWT whose payload
// carries a custom "user" claim = the Suunto App username. We trust the token
// (it came straight from the token endpoint over TLS), so we only base64url-
// decode the middle segment to read that claim — we do NOT verify the signature.

/**
 * Decode the payload (middle segment) of a JWT into an object.
 * Handles base64url alphabet (-_) and missing padding.
 * @param {string} jwt - a three-part dot-separated JWT
 * @returns {object} the decoded payload
 * @throws if the token is malformed or the payload isn't valid base64url JSON
 */
export function decodeJwtPayload(jwt) {
  if (typeof jwt !== 'string' || jwt.length === 0) {
    throw new Error('JWT must be a non-empty string');
  }
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT (expected 3 dot-separated segments)');
  }
  const payloadSeg = parts[1];
  // base64url → base64, then pad to a multiple of 4.
  const b64 = payloadSeg.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

  let json;
  try {
    json = Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    throw new Error('JWT payload is not valid base64url');
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('JWT payload is not valid JSON');
  }
}
