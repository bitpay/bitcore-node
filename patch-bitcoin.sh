#!/bin/bash

dir=$(test -n "$1" && echo "$1" || echo "${HOME}/bitcoin")
cd "$dir" || exit 1
patch -p1 < libbitcoind.patch
