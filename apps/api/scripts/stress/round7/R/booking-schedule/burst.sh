#!/bin/bash
# usage: ab.sh <new|base> <tag>
L=/tmp/claude-0/-home-user-ULTM8/ced62559-ff44-5d30-810a-e8d65570d9a9/scratchpad/round7/R
source $L/env-book.sh
[ -f $L/api.pid ] && kill $(cat $L/api.pid) 2>/dev/null; sleep 3
if [ "$1" = base ]; then W=/home/user/ULTM8/.claude/worktrees/round7-R-base; else W=/home/user/ULTM8/.claude/worktrees/round7-R; fi
cd $W/apps/api
nohup node --require ./scripts/rehearsal/use-fakes.cjs dist/main.js > $L/api-$1.log 2>&1 & echo $! > $L/api.pid
for i in $(seq 1 30); do curl -sf localhost:3383/v1/health >/dev/null && break; sleep 1; done
cd /home/user/ULTM8/.claude/worktrees/round7-R/apps/api/scripts/stress/round7/R/booking-schedule
echo "== $1 $2 load $(cut -d' ' -f1-3 /proc/loadavg)"
node burst.mjs 2>&1 | grep -E "class\(es\)"
