#!/bin/sh

cur_dir="$(pwd)"
os_dir=$(dirname "$(./platform/os.sh)")

if test -n "$1"; then
  if test "$1" = 'remote'; then
    git clone git://github.com/bitcoin/bitcoin.git || exit 1
    btc_dir="${cur_dir}/bitcoin"
  else
    btc_dir=$1
  fi
  shift
else
  btc_dir="${HOME}/bitcoin"
fi

./patch-bitcoin.sh "$btc_dir" || exit 1

cd "$btc_dir" || exit 1

./autogen.sh || exit 1
if test -n "$1"; then
  ./configure --enable-daemonlib --with-incompatible-bdb "$@" || exit 1
else
  ./configure --enable-daemonlib --with-incompatible-bdb || exit 1
fi
make || exit 1

cp src/libbitcoind.so "${os_dir}/libbitcoind.so" || exit 1

cd "$os_dir" || exit 1

rm -f xaa xab

split libbitcoind.so -n 2 || exit 1

cd "$cur_dir"
rm -rf bitcoin

echo 'Build finished successfully.'
exit 0
