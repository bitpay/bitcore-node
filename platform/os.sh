#!/bin/bash

exec 2> /dev/null

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

os=
ext=so

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

if test -z "$os" -o x"$os" = x'android' -o x"$os" = x'aix'; then
  # Maybe someday...
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
echo $ext
if test -z "$1" -o x"$1" = x'lib'; then
  if test -n "$BITCOIN_DIR" -a -e "${BITCOIN_DIR}/src/.libs/libbitcoind.${ext}"; then
    echo -n "$(pwd)/libbitcoind/src/.libs/libbitcoind.${ext}"
  else
    echo -n "$(pwd)/platform/${os}/libbitcoind.${ext}"
  fi
  exit 0
fi
