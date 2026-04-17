#!/usr/bin/env bash

# https://code.claude.com/docs/en/statusline

set -euo pipefail

# ---- Layout: "2lines" | "3lines" | "4lines" ----
LAYOUT="3lines"

json=$(cat)

# ---- Extract fields ----
cwd=$(echo "$json"         | jq -r '.workspace.current_dir // .cwd // empty')
worktree=$(echo "$json"    | jq -r '.workspace.git_worktree // empty')
model=$(echo "$json"       | jq -r '.model.display_name // empty')
session_id=$(echo "$json"  | jq -r '.session_id // "nosession"')
output_style=$(echo "$json"| jq -r '.output_style.name // empty')

ctx_used=$(echo "$json"    | jq -r '.context_window.used_percentage // 0')
cache_read=$(echo "$json"  | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
cache_write=$(echo "$json" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
exceeds_200k=$(echo "$json"| jq -r '.exceeds_200k_tokens // false')

cost_usd=$(echo "$json"    | jq -r '.cost.total_cost_usd // 0')
dur_ms=$(echo "$json"      | jq -r '.cost.total_duration_ms // 0')
api_ms=$(echo "$json"      | jq -r '.cost.total_api_duration_ms // 0')
lines_add=$(echo "$json"   | jq -r '.cost.total_lines_added // 0')
lines_rem=$(echo "$json"   | jq -r '.cost.total_lines_removed // 0')

rate_5h=$(echo "$json"     | jq -r '.rate_limits.five_hour.used_percentage // empty')
rate_5h_at=$(echo "$json"  | jq -r '.rate_limits.five_hour.resets_at // empty')
rate_7d=$(echo "$json"     | jq -r '.rate_limits.seven_day.used_percentage // empty')
rate_7d_at=$(echo "$json"  | jq -r '.rate_limits.seven_day.resets_at // empty')

# ---- Colors ----
RESET=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
CYAN=$'\033[36m'
BLUE=$'\033[34m'
BBLUE=$'\033[1;34m'
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
MAGENTA=$'\033[35m'
ORANGE=$'\033[38;5;172m'

# ---- Helpers ----
fmt_epoch_local() {
  local epoch="$1"
  date -d "@$epoch" '+%H:%M' 2>/dev/null || date -r "$epoch" '+%H:%M' 2>/dev/null || echo "?"
}

fmt_tokens() {
  local n="$1"
  if   [ "$n" -ge 1000000 ]; then awk -v n="$n" 'BEGIN{printf "%.1fM", n/1000000}'
  elif [ "$n" -ge 1000 ];    then awk -v n="$n" 'BEGIN{printf "%.1fk", n/1000}'
  else echo "$n"
  fi
}

fmt_relative() {
  local epoch="$1"
  local now delta
  now=$(date +%s)
  delta=$((epoch - now))
  if   [ "$delta" -le 0 ];   then echo "now"
  elif [ "$delta" -ge 86400 ]; then printf '%dd%dh' $((delta/86400)) $(((delta%86400)/3600))
  elif [ "$delta" -ge 3600 ];  then printf '%dh%dm' $((delta/3600))  $(((delta%3600)/60))
  else                              printf '%dm'    $((delta/60))
  fi
}

# ---- Directory + git (cached per session) ----
dir=""
[[ -n "$cwd" ]] && dir=$(basename "$cwd")

CACHE_FILE="/tmp/statusline-git-${session_id}"
CACHE_MAX_AGE=5

cache_stale() {
  [ ! -f "$CACHE_FILE" ] || \
  [ $(($(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0))) -gt $CACHE_MAX_AGE ]
}

branch=""; staged=0; modified=0; untracked=0
if [[ -n "$cwd" ]] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  if cache_stale; then
    b=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null || echo "")
    s=$(git -C "$cwd" --no-optional-locks diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
    m=$(git -C "$cwd" --no-optional-locks diff --numstat 2>/dev/null | wc -l | tr -d ' ')
    u=$(git -C "$cwd" --no-optional-locks ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
    echo "$b|$s|$m|$u" > "$CACHE_FILE"
  fi
  IFS='|' read -r branch staged modified untracked < "$CACHE_FILE"
  : "${staged:=0}" "${modified:=0}" "${untracked:=0}"
fi

# ---- Caveman ----
caveman_text=""
caveman_flag="$HOME/.claude/.caveman-active"
if [ -f "$caveman_flag" ]; then
  caveman_mode=$(cat "$caveman_flag" 2>/dev/null)
  if [ "$caveman_mode" = "full" ] || [ -z "$caveman_mode" ]; then
    caveman_text="${ORANGE}[CAVEMAN]${RESET}"
  else
    caveman_text="${ORANGE}[CAVEMAN:$(echo "$caveman_mode" | tr '[:lower:]' '[:upper:]')]${RESET}"
  fi
fi

# ---- EUR rate (cached daily) ----
RATE_FILE="$HOME/.claude/.eur-rate"
RATE_MAX_AGE=86400

eur_rate_stale() {
  [ ! -f "$RATE_FILE" ] || \
  [ $(($(date +%s) - $(stat -f %m "$RATE_FILE" 2>/dev/null || stat -c %Y "$RATE_FILE" 2>/dev/null || echo 0))) -gt $RATE_MAX_AGE ]
}

if eur_rate_stale; then
  curl -s --max-time 2 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR' 2>/dev/null \
    | jq -r '.rates.EUR // empty' > "$RATE_FILE.tmp" 2>/dev/null \
    && [ -s "$RATE_FILE.tmp" ] && mv "$RATE_FILE.tmp" "$RATE_FILE" || rm -f "$RATE_FILE.tmp"
fi
EUR_RATE=$(cat "$RATE_FILE" 2>/dev/null || echo "0.92")

# ============================================================
# Line 1: location — dir, worktree, git, lines changed
# ============================================================
line1="${CYAN}${dir}${RESET}"
[[ -n "$worktree" ]] && line1="${line1} ${DIM}(wt:${worktree})${RESET}"

if [[ -n "$branch" ]]; then
  line1="${line1} ${BBLUE}git:(${RED}${branch}${BBLUE})${RESET}"
  status_bits=""
  [ "$staged"    -gt 0 ] && status_bits="${status_bits} ${GREEN}+${staged}${RESET}"
  [ "$modified"  -gt 0 ] && status_bits="${status_bits} ${YELLOW}~${modified}${RESET}"
  [ "$untracked" -gt 0 ] && status_bits="${status_bits} ${RED}?${untracked}${RESET}"
  if [ -n "$status_bits" ]; then
    line1="${line1}${status_bits} ${YELLOW}✗${RESET}"
  fi
fi

if [ "$lines_add" -gt 0 ] || [ "$lines_rem" -gt 0 ]; then
  line1="${line1} ${GREEN}+${lines_add}${RESET}/${RED}-${lines_rem}${RESET}"
fi

# ============================================================
# Line 2: context — bar, %, cache, 200k warn, output style
# ============================================================
pct_int=$(printf '%.0f' "$ctx_used")
BAR_WIDTH=20
filled=$(( pct_int * BAR_WIDTH / 100 ))
[ "$filled" -gt "$BAR_WIDTH" ] && filled=$BAR_WIDTH
empty=$(( BAR_WIDTH - filled ))

if   [ "$pct_int" -ge 90 ]; then bar_color="$RED"
elif [ "$pct_int" -ge 70 ]; then bar_color="$YELLOW"
else                              bar_color="$GREEN"
fi

bar_fill=""; bar_pad=""
[ "$filled" -gt 0 ] && printf -v bar_fill "%${filled}s" && bar_fill="${bar_fill// /█}"
[ "$empty"  -gt 0 ] && printf -v bar_pad  "%${empty}s"  && bar_pad="${bar_pad// /░}"

line2="${bar_color}${bar_fill}${DIM}${bar_pad}${RESET} ${bar_color}${pct_int}%${RESET} ctx"

cache_total=$((cache_read + cache_write))
if [ "$cache_total" -gt 0 ]; then
  line2="${line2} ${DIM}(cache: $(fmt_tokens "$cache_read")r/$(fmt_tokens "$cache_write")w)${RESET}"
fi

if [ "$exceeds_200k" = "true" ]; then
  line2="${line2} ${RED}${BOLD}⚠ 200k+${RESET}"
fi

if [[ -n "$output_style" && "$output_style" != "default" ]]; then
  line2="${line2} ${DIM}|${RESET} ${MAGENTA}style:${output_style}${RESET}"
fi

# ============================================================
# Line 3: session economics — model, cost, burn, duration
# ============================================================
econ_parts=()
[[ -n "$caveman_text" ]] && econ_parts+=("$caveman_text")
[[ -n "$model" ]]   && econ_parts+=("${MAGENTA}${model}${RESET}")
[[ -n "${session_id}" && "${session_id}" != "nosession" ]] && econ_parts+=("${DIM}[${session_id}]${RESET}")

cost_eur=$(awk -v u="$cost_usd" -v r="$EUR_RATE" 'BEGIN{printf "%.3f", u*r}')
econ_parts+=("${GREEN}💰 €${cost_eur}${RESET}")

if [ "$dur_ms" -gt 60000 ]; then
  burn=$(awk -v u="$cost_usd" -v r="$EUR_RATE" -v ms="$dur_ms" \
    'BEGIN{printf "%.2f", (u*r) / (ms/3600000)}')
  econ_parts+=("${DIM}€${burn}/h${RESET}")
fi

dur_sec=$((dur_ms / 1000))
if [ "$dur_sec" -ge 3600 ]; then
  dur_str=$(printf '%dh%dm' $((dur_sec/3600)) $(((dur_sec%3600)/60)))
elif [ "$dur_sec" -ge 60 ]; then
  dur_str=$(printf '%dm%ds' $((dur_sec/60)) $((dur_sec%60)))
else
  dur_str="${dur_sec}s"
fi
api_pct=""
if [ "$dur_ms" -gt 0 ] && [ "$api_ms" -gt 0 ]; then
  api_pct=$(awk -v a="$api_ms" -v t="$dur_ms" 'BEGIN{printf " %d%% api", (a*100)/t}')
fi
econ_parts+=("${CYAN}⏱ ${dur_str}${RESET}${DIM}${api_pct}${RESET}")

line3=""
for i in "${!econ_parts[@]}"; do
  [ "$i" -gt 0 ] && line3="${line3} ${DIM}|${RESET} "
  line3="${line3}${econ_parts[$i]}"
done

# ============================================================
# Line 4: rate limits with reset times + projected spend
# ============================================================
limit_parts=()

if [[ -n "$rate_5h" ]]; then
  r5=$(printf '%.0f' "$rate_5h")
  if [ "$r5" -ge 90 ]; then c="$RED"; elif [ "$r5" -ge 70 ]; then c="$YELLOW"; else c="$BLUE"; fi
  reset_str=""
  proj_str=""
  if [[ -n "$rate_5h_at" ]]; then
    reset_str=" → $(fmt_epoch_local "$rate_5h_at") ($(fmt_relative "$rate_5h_at"))"
    if [ "$dur_ms" -gt 60000 ]; then
      proj=$(awk -v u="$cost_usd" -v r="$EUR_RATE" -v ms="$dur_ms" -v reset="$rate_5h_at" -v now="$(date +%s)" \
        'BEGIN{
          burn = (u*r) / (ms/3600000);
          hrs_left = (reset - now) / 3600;
          if (hrs_left < 0) hrs_left = 0;
          printf "%.2f", (u*r) + burn*hrs_left
        }')
      proj_str=" ${DIM}→ €${proj}${RESET}"
    fi
  fi
  limit_parts+=("${c}5h:${r5}%${RESET}${DIM}${reset_str}${RESET}${proj_str}")
fi

if [[ -n "$rate_7d" ]]; then
  r7=$(printf '%.0f' "$rate_7d")
  if [ "$r7" -ge 90 ]; then c="$RED"; elif [ "$r7" -ge 70 ]; then c="$YELLOW"; else c="$BLUE"; fi
  reset_str=""
  if [[ -n "$rate_7d_at" ]]; then
    day=$(date -d "@$rate_7d_at" '+%a %H:%M' 2>/dev/null || date -r "$rate_7d_at" '+%a %H:%M' 2>/dev/null || echo "?")
    reset_str=" → ${day} ($(fmt_relative "$rate_7d_at"))"
  fi
  limit_parts+=("${c}7d:${r7}%${RESET}${DIM}${reset_str}${RESET}")
fi

line4=""
for i in "${!limit_parts[@]}"; do
  [ "$i" -gt 0 ] && line4="${line4} ${DIM}|${RESET} "
  line4="${line4}${limit_parts[$i]}"
done

# ---- Output ----
case "$LAYOUT" in
  2lines)
    if [[ -n "$line4" ]]; then
      printf '%s%s%s\n%s%s%s\n' "$line1" " ${DIM}|${RESET} " "$line2" "$line3" " ${DIM}|${RESET} " "$line4"
    else
      printf '%s%s%s\n%s\n' "$line1" " ${DIM}|${RESET} " "$line2" "$line3"
    fi
    ;;
  3lines)
    printf '%s%s%s\n%s\n' "$line1" " ${DIM}|${RESET} " "$line2" "$line3"
    [[ -n "$line4" ]] && printf '%s\n' "$line4"
    ;;
  4lines|*)
    printf '%s\n%s\n%s\n' "$line1" "$line3" "$line2"
    [[ -n "$line4" ]] && printf '%s\n' "$line4"
    ;;
esac
