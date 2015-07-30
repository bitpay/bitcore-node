#!/bin/bash

exec 2> /dev/null

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
BITCOIN_DIR="${root_dir}/libbitcoind"
os=
ext=so

host=`uname -m`-`uname -a | awk '{print tolower($1)}'`
depends_dir="${BITCOIN_DIR}"/depends
h_and_a_dir="${depends_dir}"/"${host}"

if test -f /etc/centos-release \
  || grep -q 'CentOS' /etc/redhat-release \
  || rpm -q --queryformat '%{VERSION}' centos-release > /dev/null; then
  os=centos
elif grep -q 'Fedora' /etc/system-release; then
  os=fedora
elif test -f /etc/redhat_release \
  || test -f /etc/redhat-release; then
  os=rhel
elif uname -a | grep -q '^Darwin'; then
  os=osx
  ext=dylib
elif test -f /etc/SuSE-release; then
  os=suse
elif test -f /etc/mandrake-release \
  || test -f /etc/mandriva-release; then
  os=mandriva
elif grep -q 'Linux Mint' /etc/issue; then
  os=mint
elif grep -q 'Ubuntu' /etc/issue \
  || grep -q 'Ubuntu' /etc/lsb-release \
  || uname -v | grep -q 'Ubuntu'; then
  os=ubuntu
elif test -f /etc/debian_version \
  || test -f /etc/debian-version; then
  os=debian
elif grep -q 'Arch Linux' /etc/issue \
  || test -d /lib/systemd -a "$(readlink /usr/bin/vi)" = 'ex'; then
  os=arch
elif test "$(uname -s)" = 'SunOS'; then
  os=solaris
elif test "$(uname -s)" = 'AIX'; then
  os=aix
elif test -d /system && test -d /data/data; then
  os=android
fi

os_dir=${root_dir}/platform/${os}

if [ "${os}"  == "osx" ]; then
  artifacts_dir="${os_dir}/lib"
else
  artifacts_dir="${os_dir}"
fi

thread="${artifacts_dir}"/lib/libboost_thread-mt.a
filesystem="${artifacts_dir}"/lib/libboost_filesystem-mt.a

if test -z "$os" -o x"$os" = x'android' -o x"$os" = x'aix'; then
  if test "$os" = 'android' -o "$os" = 'aix'; then
    echo 'Android or AIX detected!' >& 2
  fi
  echo 'OS not supported.' >& 2
  exit 1
fi

if test x"$1" = x'osdir'; then
  echo -n "$(pwd)/platform/${os}"
  exit 0
fi

if test x"$1" = x'btcdir'; then
  echo -n "${BITCOIN_DIR}"
  exit 0
fi

if test -z "$1" -o x"$1" = x'ext'; then
  echo -n "${ext}"
fi

if test -z "$1" -o x"$1" = x'thread'; then
  echo -n "${thread}"
fi

if test -z "$1" -o x"$1" = x'filesystem'; then
  echo -n "${filesystem}"
fi

if test -z "$1" -o x"$1" = x'depends_dir'; then
  echo -n "${depends_dir}"
fi

if test -z "$1" -o x"$1" = x'h_and_a_dir'; then
  echo -n "${h_and_a_dir}"
fi

if test -z "$1" -o x"$1" = x'host'; then
  echo -n "${host}"
fi

if test -z "$1" -o x"$1" = x'load_archive'; then
  if [ "${os}"  == "osx" ]; then
    echo -n "-Wl,-all_load"
  else
    echo -n "-Wl,--whole-archive ${filesystem} ${thread} -Wl,--no-whole-archive"
  fi
fi

if test -z "$1" -o x"$1" = x'artifacts_dir'; then
  echo -n "${artifacts_dir}" 
fi

if test -z "$1" -o x"$1" = x'lib'; then
  if test -e "${os_dir}/libbitcoind.${ext}" -o -e "${os_dir}/lib/libbitcoind.${ext}"; then
    if test -e "${os_dir}/lib/libbitcoind.${ext}"; then
      echo -n "$(pwd)/platform/${os}/lib/libbitcoind.${ext}"
    else
      echo -n "$(pwd)/platform/${os}/libbitcoind.${ext}"
    fi
  else
    echo -n "${BITCOIN_DIR}/src/.libs/libbitcoind.${ext}"
  fi
  exit 0
fi
