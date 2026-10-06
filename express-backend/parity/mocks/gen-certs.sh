#!/usr/bin/env bash
# Generates the parity mocks' throwaway TLS material into parity/mocks/certs/
# (gitignored — never commit it):
#   ca.pem       test CA certificate (its private key is deleted right after signing)
#   server.pem   leaf cert for the provider hostnames the mock container aliases
#   server.key   leaf private key
#   bundle.pem   Mozilla roots (certifi, from the Django image) + ca.pem — for
#                Python clients that take a whole bundle (requests, stripe-python)
# Idempotent: does nothing when a valid set already exists. Safe to run from
# several parity environments at once (builds in a temp dir, renames into place).
set -euo pipefail
cd "$(dirname "$0")"
OUT=certs
HOSTS=(api.stripe.com proxy.momoapi.mtn.com sandbox.momodeveloper.mtn.com parity-mocks)

if [[ -s $OUT/ca.pem && -s $OUT/server.pem && -s $OUT/server.key && -s $OUT/bundle.pem ]] \
   && openssl x509 -in "$OUT/server.pem" -noout -checkend 86400 >/dev/null 2>&1; then
  exit 0
fi

TMP="$(mktemp -d "$PWD/.certs.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
SAN=$(printf 'DNS:%s,' "${HOSTS[@]}"); SAN=${SAN%,}

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 -keyout "$TMP/ca.key" -out "$TMP/ca.pem" \
  -subj "/CN=HomeKonet Parity Throwaway Test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -sha256 -keyout "$TMP/server.key" -out "$TMP/server.csr" -subj "/CN=parity-mocks" 2>/dev/null
cat > "$TMP/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF
openssl x509 -req -sha256 -days 825 -in "$TMP/server.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca.key" -CAcreateserial \
  -out "$TMP/server.pem" -extfile "$TMP/ext.cnf" 2>/dev/null
rm -f "$TMP/ca.key" "$TMP/server.csr" "$TMP/ext.cnf" "$TMP"/*.srl

docker run --rm --entrypoint python homekonet-backend -c "import certifi, sys; sys.stdout.write(open(certifi.where()).read())" > "$TMP/bundle.pem"
grep -q 'BEGIN CERTIFICATE' "$TMP/bundle.pem" || { echo "could not read certifi bundle from homekonet-backend" >&2; exit 1; }
{ echo; echo "# HomeKonet parity throwaway test CA"; cat "$TMP/ca.pem"; } >> "$TMP/bundle.pem"
chmod 755 "$TMP"; chmod 644 "$TMP"/*.pem "$TMP/server.key"

rm -rf "$OUT.old"; [[ -d $OUT ]] && mv "$OUT" "$OUT.old"
mv "$TMP" "$OUT"; trap - EXIT
rm -rf "$OUT.old"
