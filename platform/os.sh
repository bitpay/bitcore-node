#!/bin/bash

if test -n "$BITCOIN_DIR" -a -e "${BITCOIN_DIR}/src/libbitcoind.so"; then
  echo -n "${BITCOIN_DIR}/src/libbitcoind.so"
  exit 0
fi

name=$(uname -a)
os=

if echo "$name" | grep -q -i 'debian'; then
  os=debian
elif echo "$name" | grep -q 'Ubuntu'; then
  os=ubuntu
elif echo "$name" | grep -q '^Darwin'; then
  os=osx
elif echo "$name" | grep -q 'ARCH' \
&& test "$(uname -o 2> /dev/null)" = 'GNU/Linux'; then
  os=arch
fi

if test -z "$os"; then
  echo 'OS not supported.' >& 2
  exit 1
fi

if test ! -e platform/${os}/libbitcoind.so; then
  cat platform/${os}/{xaa,xab} > platform/${os}/libbitcoind.so
  chmod 0755 platform/${os}/libbitcoind.so
fi

echo -n "$(pwd)/platform/${os}/libbitcoind.so"
