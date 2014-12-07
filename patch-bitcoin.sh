#!/bin/sh

dir=$(test -n "$1" && echo "$1" || echo "${HOME}/bitcoin")

cd "$dir" || exit 1

if test -e .git; then
  git checkout -b libbitcoind || exit 1
fi

patch -p1 < libbitcoind.patch || exit 1

if test -e .git; then
  git add --all || exit 1
  git commit -a -m 'allow compiling of libbitcoind.so.' || exit 1
fi

echo 'Patch completed successfully.'
exit 0
