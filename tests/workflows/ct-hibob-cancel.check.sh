#!/usr/bin/env bash
# Replays the Connecteam -> HiBob cancellation fixtures against a local checkout of the
# Reverse workflow and asserts the path taken and the HiBob request it would send.
# Usage: tests/workflows/ct-hibob-cancel.check.sh "/path/to/Connecteam - Hibob Vacation Sync (Reverse)"
set -euo pipefail
workflow="${1:?workflow directory required}"
cd "$(dirname "$0")/../.."
failures=0

check() {
  local fixture="$1" filter="$2" label="$3"
  local result
  result="$(pnpm -s workflow -- --workflow "$workflow" --mode mock --fixture "tests/workflows/$fixture" || true)"
  if jq -e "$filter" >/dev/null <<<"$result"; then
    echo "PASS  $label"
  else
    echo "FAIL  $label"
    jq -c '{status, path: [.blocks[] | .id + (if .selectedPath then "→"+.selectedPath else "" end)], last: .blocks[-1]}' <<<"$result"
    failures=$((failures + 1))
  fi
}

check ct-hibob-decline-cancels.mock.yml \
  '.status == "success"
   and (.blocks[] | select(.id == "branch_event_type") | .selectedPath) == "1"
   and (.blocks[] | select(.id == "branch_hibob_still_live") | .selectedPath) == "0"
   and (.blocks[] | select(.id == "cancel_hibob_request") | .request) == {method: "DELETE", path: "timeoff/employees/3000000000000000001/requests/70000001"}
   and (.blocks[-1].id == "update_cancel_log")' \
  'decline of a synced time-off deletes the HiBob request and logs the cancel'

check ct-hibob-decline-already-cancelled.mock.yml \
  '.status == "success" and .blocks[-1].id == "cancel_already_done_log"
   and (.blocks[] | select(.id == "get_hibob_status") | .request) == {method: "GET", path: "timeoff/employees/3000000000000000001/requests/70000001"}
   and ([.blocks[].id] | index("cancel_hibob_request")) == null' \
  'decline of a time-off already cancelled in HiBob reads it, sends no DELETE, logs a no-op'

check ct-hibob-decline-not-synced.mock.yml \
  '.status == "success" and .blocks[-1].id == "cancel_noop_log"
   and ([.blocks[].id] | index("cancel_hibob_request")) == null' \
  'decline of a never-synced time-off is a logged no-op with no DELETE'

check ct-hibob-shift-delete-ignored.mock.yml \
  '.status == "success" and (.blocks[] | select(.id == "parse_webhook") | .data.ignored) == true
   and ([.blocks[].id] | index("insert_event")) == null' \
  'shift delete is ignored before anything is logged'

# The add path needs moment(), which the runner does not provide yet, so this only
# asserts the routing up to the first block after the branch.
check ct-hibob-approved-add-routes.mock.yml \
  '(.blocks[] | select(.id == "branch_event_type") | .selectedPath) == "0"
   and ([.blocks[].id] | index("get_ct_request_details")) != null' \
  'approved add still takes the add/edit path'

exit "$failures"
