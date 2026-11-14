# Shared helpers. Sourced, not executed.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# .env is gitignored and holds the account names. .env.example documents the shape.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${NEAR_NETWORK:=testnet}"

need_parent() {
  if [ -z "${MMIRI_PARENT:-}" ]; then
    cat >&2 <<EOT

MMIRI_PARENT is not set.

Create a testnet account you control (near-faucet.io, or the NEAR wallet), log in
with the CLI, then put its name in .env:

    cp .env.example .env
    \$EDITOR .env          # set MMIRI_PARENT=your-account.testnet
    near account import-account using-web-wallet network-config testnet

Everything else is a sub-account of it.

EOT
    exit 1
  fi
}

MARKET="${MMIRI_MARKET:-market.${MMIRI_PARENT:-unset}}"
USDC="${MMIRI_USDC:-usdc.${MMIRI_PARENT:-unset}}"
KEEPER="${MMIRI_KEEPER:-keeper.${MMIRI_PARENT:-unset}}"
AGENTS=(uw-1 uw-2 uw-3 uw-4 uw-5)

# near-cli-rs is a long chain of subcommands; these keep the scripts readable.
NET=(network-config "$NEAR_NETWORK")
SIGN=(sign-with-keychain send)

say() { printf '\n==> %s\n' "$*"; }

require_cli() {
  command -v near >/dev/null 2>&1 || {
    echo "near CLI not found. Install it with:  npm i -g near-cli-rs" >&2
    exit 1
  }
}

# Creates a sub-account only if it does not already exist, so the scripts can be re-run.
ensure_account() {
  local id="$1" balance="$2"
  # `now` is the block reference, and it is required: without it near-cli-rs cannot
  # complete the command non-interactively, exits non-zero, and every account reads as
  # absent -- which made the create below run against accounts that already existed.
  if near account view-account-summary "$id" "${NET[@]}" now >/dev/null 2>&1; then
    echo "    $id already exists"
    return 0
  fi
  echo "    creating $id"
  near account create-account fund-myself "$id" "$balance" \
    autogenerate-new-keypair save-to-keychain \
    sign-as "$MMIRI_PARENT" "${NET[@]}" "${SIGN[@]}"
}

# The RPC URL for the selected network, used where machine-readable output beats the
# CLI's human formatting.
rpc_url() {
  if [ "$NEAR_NETWORK" = "mainnet" ]; then
    echo "${NEAR_RPC_URL:-https://rpc.mainnet.near.org}"
  else
    echo "${NEAR_RPC_URL:-https://rpc.testnet.near.org}"
  fi
}

# Prints the FullAccess public keys on an account, one per line.
full_access_keys() {
  local id="$1"
  curl -sS -X POST "$(rpc_url)" -H 'Content-Type: application/json' -d "{
      \"jsonrpc\":\"2.0\",\"id\":\"k\",\"method\":\"query\",
      \"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$id\"}
    }" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for k in d.get("result",{}).get("keys",[]):
    if k.get("access_key",{}).get("permission") == "FullAccess":
        print(k["public_key"])
'
}
