#!/bin/sh

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
cd "$root_dir"
dir=$(test -n "$1" && echo "$1" || echo "${HOME}/bitcoin")
patch_file="$(pwd)/bitcoin.patch"

cd "$dir" || exit 1

if ! test -d .git; then
  echo 'Please point this script to an upstream bitcoin git repo.'
  exit 1
fi

git checkout 0a1d03ca5265293e6419b0ffb68d277da6b1d9a0
if test $? -ne 0; then
  echo 'Unable to checkout necessary commit.'
  echo 'Please pull the latest HEAD from the upstream bitcoin repo.'
  exit 1
fi
git checkout -b "libbitcoind-$(date '+%Y.%m.%d')" || exit 1

patch -p1 < "$patch_file" || exit 1

git add --all || exit 1
git commit -a -m 'allow compiling of libbitcoind.so.' || exit 1

echo 'Patch completed successfully.'
exit 0
