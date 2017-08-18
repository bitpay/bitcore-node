#!/bin/bash

# helper script to run bwdb and/or restart it

# execute thie script and then simply tail /tmp/bwdb-out
# e.g. ./contrib/restart_bwdb.sh && tail -f /tmp/bwdb-out

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
pkill -2 -x bitcore
wait
exec $DIR/../bin/bitcore-node start >> /tmp/bwdb-out 2>&1 &
