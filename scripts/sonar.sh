#!/bin/sh
# Run sonar-scanner, then:
#   - Print all new issues (bugs, smells, vulnerabilities) so Claude can fix them
#   - Open the SonarCloud new-code summary for hotspots requiring human review
#   - Exit non-zero if any findings exist so the verification pipeline catches them
[ -f .env ] && export $(grep -v '^#' .env | xargs)

sonar-scanner
CODE=$?

BRANCH=$(git rev-parse --abbrev-ref HEAD)
URL="https://sonarcloud.io/summary/new_code?id=kirbo_electrolux-to-mqtt&branch=${BRANCH}"
BASE="https://sonarcloud.io/api"
AUTH="${SONAR_TOKEN}:"
PROJECT="kirbo_electrolux-to-mqtt"

# Gate failed — open dashboard and exit immediately
if [ "${CODE}" -ne 0 ]; then
  open "${URL}"
  exit "${CODE}"
fi

FOUND=0

# ── New issues (bugs, vulnerabilities, code smells) ──────────────────────────
ISSUES_JSON=$(curl -sf -u "${AUTH}" \
  "${BASE}/issues/search?componentKeys=${PROJECT}&resolved=false&inNewCodePeriod=true&branch=${BRANCH}&ps=50")

ISSUE_COUNT=$(printf '%s' "${ISSUES_JSON}" | node -e \
  "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).total||0))" 2>/dev/null || echo 0)

if [ "${ISSUE_COUNT}" -gt 0 ]; then
  FOUND=1
  printf '\n=== %s new issue(s) to fix ===\n' "${ISSUE_COUNT}"
  printf '%s' "${ISSUES_JSON}" | node -e "
    const issues = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).issues || [];
    issues.forEach(i => {
      const file = i.component.split(':').slice(1).join(':');
      const loc  = i.line ? ':' + i.line : '';
      console.log('[' + i.type + '] ' + i.severity + ' — ' + file + loc);
      console.log('  ' + i.message + ' (' + i.rule + ')');
    });
  " 2>/dev/null
fi

# ── Unreviewed security hotspots ─────────────────────────────────────────────
HOTSPOTS_JSON=$(curl -sf -u "${AUTH}" \
  "${BASE}/hotspots/search?projectKey=${PROJECT}&status=TO_REVIEW&inNewCodePeriod=true&branch=${BRANCH}&ps=50")

HOTSPOT_COUNT=$(printf '%s' "${HOTSPOTS_JSON}" | node -e \
  "process.stdout.write(String((JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).paging||{}).total||0))" 2>/dev/null || echo 0)

if [ "${HOTSPOT_COUNT}" -gt 0 ]; then
  FOUND=1
  printf '\n=== %s unreviewed hotspot(s) — needs your decision before marking safe ===\n' "${HOTSPOT_COUNT}"
  printf '%s' "${HOTSPOTS_JSON}" | node -e "
    const hs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).hotspots || [];
    hs.forEach(h => {
      const file = h.component.split(':').slice(1).join(':');
      const loc  = h.line ? ':' + h.line : '';
      console.log('[HOTSPOT] ' + h.vulnerabilityProbability + ' — ' + file + loc);
      console.log('  ' + h.message + ' (' + h.ruleKey + ')');
      console.log('  key: ' + h.key);
    });
  " 2>/dev/null
  open "${URL}"
fi

# Exit non-zero if anything needs attention
[ "${FOUND}" -eq 0 ] && exit 0 || exit 1
