#!/bin/bash

if test x"$1" = x'btcdir'; then
  if test -n "$BITCOIN_DIR"; then
    echo "$BITCOIND_DIR"
  elif test -d "$(pwd)/libbitcoind"; then
    echo "$(pwd)/libbitcoind"
  elif test -d "${HOME}/bitcoin"; then
    echo "${HOME}/bitcoin"
  fi
  exit 0
fi

name=$(uname -a)
os=

if echo "$name" | grep -q -i 'cent'; then
  os=centos
elif echo "$name" | grep -q -i 'debian'; then
  os=debian
elif echo "$name" | grep -q -i 'fedora'; then
  os=fedora
elif echo "$name" | grep -q -i 'mint'; then
  os=mint
elif echo "$name" | grep -q '^Darwin'; then
  os=osx
elif echo "$name" | grep -q -i 'redhat'; then
  os=rhel
elif echo "$name" | grep -q -i 'suse'; then
  os=suse
elif echo "$name" | grep -q 'Ubuntu'; then
  os=ubuntu
elif test "$(uname -o 2> /dev/null)" = 'GNU/Linux'; then
  os=arch
fi

# Maybe someday...
# if test -d /system && test -d /data/data; then
#   os=android
# fi

if test -z "$os"; then
  # Arch is hard to detect. Check some unique properties of Arch:
  if test -d /lib/systemd && test "$(readlink /usr/bin/vi)" = 'ex'; then
    os=arch
  else
    echo 'OS not supported.' >& 2
    exit 1
  fi
fi

if test x"$1" = x'osdir'; then
  echo -n "$(pwd)/platform/${os}"
  exit 0
fi

if test -z "$1" -o x"$1" = x'lib'; then
  if test -n "$BITCOIN_DIR" -a -e "${BITCOIN_DIR}/src/libbitcoind.so"; then
    echo -n "${BITCOIN_DIR}/src/libbitcoind.so"
  else
    echo -n "$(pwd)/platform/${os}/libbitcoind.so"
  fi
  exit 0
fi
