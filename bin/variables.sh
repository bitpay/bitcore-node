#!/bin/bash

exec 2> /dev/null

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
bitcoin_dir="${root_dir}"/libbitcoind
cache_dir="${root_dir}"/cache

platform=`uname -a | awk '{print tolower($1)}'`
arch=`uname -m`
host="${arch}"-"${platform}"

mac_response=
check_mac_build_system () {
  if [ "${platform}" == "darwin" ]; then
    if [ ! -d "/usr/include" ]; then
      if hash xcode-select 2>/dev/null; then
        mac_response="Please run 'xcode-select --install' from the command line because it seems that you've got Xcode, but not the Xcode command line tools that are required for compiling this project from source..."
      else
        mac_response="please use the App Store to install Xcode and Xcode command line tools. After Xcode is installed, please run: 'xcode-select --install' from the command line"
      fi
    fi
  fi
}

depends_dir="${bitcoin_dir}"/depends
thread="${cache_dir}"/depends/"${host}"/lib/libboost_thread-mt.a
filesystem="${cache_dir}"/depends/"${host}"/lib/libboost_filesystem-mt.a
chrono="${cache_dir}"/depends/"${host}"/lib/libboost_chrono-mt.a
program_options="${cache_dir}"/depends/"${host}"/lib/libboost_program_options-mt.a
system="${cache_dir}"/depends/"${host}"/lib/libboost_system-mt.a
leveldb="${cache_dir}"/src/leveldb/libleveldb.a
memenv="${cache_dir}"/src/leveldb/libmemenv.a
libsecp256k1="${cache_dir}"/src/secp256k1/.libs/libsecp256k1.a

if test x"$1" = x'anl'; then
  if [ "${platform}" != "darwin" ]; then
    echo -n "-lanl"
  fi
fi

if test x"$1" = x'cache_dir'; then
  echo -n "${cache_dir}"
fi

if test x"$1" = x'btcdir'; then
  echo -n "${bitcoin_dir}"
fi

if test -z "$1" -o x"$1" = x'thread'; then
  echo -n "${thread}"
fi

if test -z "$1" -o x"$1" = x'filesystem'; then
  echo -n "${filesystem}"
fi

if test -z "$1" -o x"$1" = x'program_options'; then
  echo -n "${program_options}"
fi

if test -z "$1" -o x"$1" = x'system'; then
  echo -n "${system}"
fi

if test -z "$1" -o x"$1" = x'chrono'; then
  echo -n "${chrono}"
fi

if test -z "$1" -o x"$1" = x'depends_dir'; then
  echo -n "${depends_dir}"
fi

if test -z "$1" -o x"$1" = x'leveldb'; then
  echo -n "${leveldb}"
fi

if test -z "$1" -o x"$1" = x'memenv'; then
  echo -n "${memenv}"
fi

if test -z "$1" -o x"$1" = x'libsecp256k1'; then
  echo -n "${libsecp256k1}"
fi

if test -z "$1" -o x"$1" = x'host'; then
  echo -n "${host}"
fi

if test -z "$1" -o x"$1" = x'bdb'; then
  if [ "${BITCORENODE_ENV}" == "test" ]; then
    echo -n "${cache_dir}"/depends/"${host}"/lib/libdb_cxx.a
  fi
fi

if test -z "$1" -o x"$1" = x'patch_sha'; then
  echo -n "${root_dir}"/cache/patch_sha.txt
fi

if test -z "$1" -o x"$1" = x'load_archive'; then
  if [ "${os}"  == "osx" ]; then
    echo -n "-Wl,-all_load -Wl,--no-undefined"
  else
    echo -n "-Wl,--whole-archive ${filesystem} ${thread} "${cache_dir}"/src/.libs/libbitcoind.a -Wl,--no-whole-archive"
  fi
fi

if test -z "$1" -o x"$1" = x'mac_dependencies'; then
  check_mac_build_system
  echo -n "${mac_response}"
fi

if test -z "$1" -o x"$1" = x'wallet_enabled'; then
  if [ "${BITCORENODE_ENV}" == "test" ]; then
    echo -n "-DENABLE_WALLET"
  fi
fi

if test -z "$1" -o x"$1" = x'bitcoind'; then
  echo -n "${cache_dir}"/src/.libs/libbitcoind.a
fi
