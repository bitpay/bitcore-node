#!/bin/sh

dir=$(test -n "$1" && echo "$1" || echo "${HOME}/bitcoin")
patch_file="$(pwd)/libbitcoind.patch"

cd "$dir" || exit 1

if ! test -d .git; then
  echo 'Please point this script to an upstream bitcoin git repo.'
  exit 1
fi

git checkout 4383319e4e0cb96818d2be734f7280181daac9fa
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
