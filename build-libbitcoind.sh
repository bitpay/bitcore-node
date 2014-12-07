#!/bin/sh

cur_dir="$(pwd)"
os_dir=$(dirname "$(./platform/os.sh)")

if test -e "${os_dir}/libbitcoind.so"; then
  read -r -p 'libbitcoind.so already built. Rebuild? (Y/n): ' choice
  if test x"$choice" != x'y' -a x"$choice" != x'Y'; then
    echo 'libbitcoind.so ready.'
    exit 0
  fi
  rm -f "${os_dir}/libbitcoind.so"
fi

if test -n "$1"; then
  if test "$1" = 'remote'; then
    echo 'git clone'
    git clone git://github.com/bitcoin/bitcoin.git libbitcoind || exit 1
    btc_dir="${cur_dir}/libbitcoind"
  else
    btc_dir=$1
    if ! test -d "$btc_dir"; then
      "$0" remote
      exit 0
    fi
  fi
  shift
else
  btc_dir="${HOME}/bitcoin"
  if ! test -d "$btc_dir"; then
    "$0" remote
    exit 0
  fi
fi

echo "Found BTC directory: $btc_dir"

echo './patch-bitcoin.sh' "$btc_dir"
./patch-bitcoin.sh "$btc_dir" || exit 1

cd "$btc_dir" || exit 1

if ! test -d .git; then
  echo 'Please point this script to an upstream bitcoin git repo.'
  exit 1
fi

bdb_compat=0
if cat /usr/include/db.h | grep -i DB_VERSION_STRING | grep -q 'DB 4.8' \
  || test -e /usr/include/db4.8 \
  || test -e /usr/include/db4.8.h; then
  bdb_compat=1
fi
if test $bdb_compat -eq 0; then
  set -- "--with-incompatible-bdb" "$@"
fi

echo './autogen.sh'
./autogen.sh || exit 1
if test -n "$1"; then
  echo './configure --enable-daemonlib' "$@"
  ./configure --enable-daemonlib "$@" || exit 1
else
  echo './configure --enable-daemonlib'
  ./configure --enable-daemonlib || exit 1
fi
echo 'make'
make || exit 1

echo 'Copying libbitcoind.so to its appropriate location.'
cp src/libbitcoind.so "${os_dir}/libbitcoind.so" || exit 1

cd "$cur_dir"
rm -rf libbitcoind

echo 'Build finished successfully.'
exit 0
