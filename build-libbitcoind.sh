#!/bin/sh

btc_dir=$(test -n "$1" && echo "$1" || echo "${HOME}/bitcoin")
os_dir=$(dirname "$(./platform/os.sh)")
shift

./patch-bitcoin.sh "$btc_dir" || exit 1

cd "$btc_dir" || exit 1

./autogen.sh || exit 1
./configure --enable-daemonlib --with-incompatible-bdb "$@" || exit 1
make || exit 1

cp src/libbitcoind.so "${os_dir}/libbitcoind.so" || exit 1

cd "$os_dir" || exit 1

rm -f xaa xab

split libbitcoind.so -n 2 || exit 1

echo 'Build finished successfully.'
exit 0
