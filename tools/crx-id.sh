#!/bin/bash
# Derive a Chromium extension ID from an RSA signing key.
#
# The ID is the first 16 bytes of the SHA-256 of the DER-encoded public key,
# hex-encoded, with the digits 0-9a-f mapped onto a-p. This is exactly how
# Chromium computes it, so the value printed here is what must appear as the
# appid in update.xml and in the ExtensionInstallForcelist policy.
#
#   tools/crx-id.sh key.pem              print the ID for an existing key
#   tools/crx-id.sh --generate key.pem   create the key first, then print it
set -euo pipefail

GENERATE=0
if [[ "${1:-}" == "--generate" ]]; then
	GENERATE=1
	shift
fi

KEY_FILE="${1:-}"
if [[ -z "$KEY_FILE" ]]; then
	echo "usage: $0 [--generate] <key.pem>" >&2
	exit 1
fi

if [[ "$GENERATE" == 1 ]]; then
	if [[ -e "$KEY_FILE" ]]; then
		echo "refusing to overwrite existing key: $KEY_FILE" >&2
		echo "the extension ID is derived from this key; replacing it changes the ID" >&2
		exit 1
	fi
	(umask 077 && openssl genrsa -out "$KEY_FILE" 2048 2>/dev/null)
	echo "wrote $KEY_FILE (keep this secret and out of git)" >&2
fi

openssl rsa -in "$KEY_FILE" -pubout -outform DER 2>/dev/null \
	| openssl dgst -sha256 -binary \
	| head -c 16 \
	| xxd -p \
	| tr -d '\n' \
	| tr '0-9a-f' 'a-p'
echo
