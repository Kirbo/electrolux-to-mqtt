#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="age-key.txt"
GITIGNORE=".gitignore"
SOPS_YAML=".sops.yaml"
OP_ITEM="electrolux-to-mqtt age key"

# 1. Ensure key file is gitignored
if ! grep -qxF "${KEY_FILE}" "${GITIGNORE}"; then
  echo "${KEY_FILE}" >> "${GITIGNORE}"
  echo "Added ${KEY_FILE} to .gitignore"
fi

# 2. Generate new age keypair (post-quantum hybrid ML-KEM-768 + X25519)
age-keygen -pq -o "${KEY_FILE}"
NEW_PUBLIC_KEY=$(grep "public key:" "${KEY_FILE}" | awk '{print $NF}')
NEW_PRIVATE_KEY=$(grep "^AGE-SECRET-KEY" "${KEY_FILE}")
echo "Generated new key: ${NEW_PUBLIC_KEY}"

# 3. Get old key from 1Password and decrypt all .env*.enc files
echo "Decrypting all .env files with current key..."
OLD_KEY=$(op item get "${OP_ITEM}" \
  --vault=Personal \
  --account=my.1password.com \
  --fields 'private key' \
  --format json \
  | jq -r '.value')

enc_files=$(find . telemetry-backend -maxdepth 1 -name ".env*.enc" | sort)
if [[ -z "${enc_files}" ]]; then
  echo "No .env*.enc files found" >&2
  rm "${KEY_FILE}"
  exit 1
fi
while IFS= read -r src; do
  dst="${src%.enc}"
  SOPS_AGE_KEY="${OLD_KEY}" sops --decrypt --input-type binary --output-type binary "${src}" > "${dst}"
  echo "Decrypted ${src} → ${dst}"
done <<< "${enc_files}"

# 4. Update .sops.yaml with new public key
sed -i '' "s/age: age1.*/age: ${NEW_PUBLIC_KEY}/" "${SOPS_YAML}"
echo "Updated .sops.yaml"

# 5. Re-encrypt all .env files with new key
plain_files=$(find . telemetry-backend -maxdepth 1 -name ".env*" ! -name "*.enc" ! -name ".env.example" | sort)
while IFS= read -r src; do
  dst="${src}.enc"
  SOPS_AGE_KEY="${NEW_PRIVATE_KEY}" sops --encrypt --input-type binary --output-type binary "${src}" > "${dst}"
  echo "Re-encrypted ${src} → ${dst}"
done <<< "${plain_files}"

# 6. Store new key in 1Password
op item edit "${OP_ITEM}" \
  --vault=Personal \
  --account=my.1password.com \
  "public key[text]=${NEW_PUBLIC_KEY}" \
  "private key[concealed]=${NEW_PRIVATE_KEY}" > /dev/null
echo "Updated 1Password"

# 7. Verify round-trip with new key from 1Password
echo "Verifying..."
VERIFY_KEY=$(op item get "${OP_ITEM}" \
  --vault=Personal \
  --account=my.1password.com \
  --fields 'private key' \
  --format json \
  | jq -r '.value')
while IFS= read -r src; do
  SOPS_AGE_KEY="${VERIFY_KEY}" sops --decrypt --input-type binary --output-type binary "${src}" > /dev/null
done <<< "${enc_files}"
echo "Verification passed"

# 8. Clean up
rm "${KEY_FILE}"

# 9. Sync the new private key to GitLab CI/CD (File-type SOPS_AGE_KEY_FILE) so the deploy job can
#    still decrypt telemetry-backend/.env.enc. Best-effort: a GitLab/PAT hiccup shouldn't fail the
#    whole rotation — re-run `pnpm sops:sync-ci` once access is sorted. (1Password step 6 already
#    updated the key the sync re-reads.)
echo ""
if "$(dirname "$0")/sync-ci-age-key.sh"; then
  echo "GitLab CI/CD SOPS_AGE_KEY_FILE updated to the new key."
else
  echo "WARNING: couldn't sync the new key to GitLab CI/CD — re-run 'pnpm sops:sync-ci' after fixing." >&2
fi

echo ""
echo "Rotation complete. Commit: .sops.yaml and all .env*.enc files"
