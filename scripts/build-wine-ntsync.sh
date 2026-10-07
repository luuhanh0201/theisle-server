#!/usr/bin/env bash
# build-wine-ntsync.sh, Wine with ntsync for the VPS (2026-10-07). WineHQ's Ubuntu 24.04 package is built
# without ntsync (24.04's headers predate it); the server's kernel has it (HWE 7.0, /dev/ntsync). Measured on the
# live server, the same load: game CPU 101 % -> 87 %, the game thread 84 % -> 72 %, wineserver 4 % -> 1 %, the
# lowest FPS 22 -> 30.
#
#   scripts/build-wine-ntsync.sh [version]      (default 11.0; Docker, on any machine; about an hour)
#   -> ~/winebuild-out/wine-ntsync-<version>.tar.gz  (unpacks to home/isle/wine-ntsync)
#
# Install on the VPS (as isle, no root), the game stopped or restarted after:
#   cd /home/isle && mv wine-ntsync wine-ntsync.old && tar xzf wine-ntsync-<v>.tar.gz --strip-components=2
# start.sh runs /home/isle/wine-ntsync/bin/wine, the server's only Wine. The build runs in ubuntu:24.04 (the VPS's
# libraries), headless, WoW64, on the home disk (not /tmp: a tmpfs, the build is ~6 GB).
set -euo pipefail
V="${1:-11.0}"
W="$HOME/winebuild"; OUT="$HOME/winebuild-out"
mkdir -p "$W" "$OUT"
HOST=$(grep '^DEPLOY_HOST=' "$(dirname "$0")/../.env" | cut -d= -f2- | tr -d '"')
scp -q "$HOST:/usr/src/linux-headers-$(ssh "$HOST" uname -r)/include/uapi/linux/ntsync.h" "$W/ntsync.h"
docker run --rm -v "$W:/work" -v "$OUT:/dst" -e V="$V" -e OWNER="$(id -u):$(id -g)" ubuntu:24.04 bash -c '
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential flex bison gcc-mingw-w64 binutils-mingw-w64 pkg-config wget xz-utils gettext \
  libfreetype-dev libgnutls28-dev libunwind-dev libdbus-1-dev >/dev/null
cp /work/ntsync.h /usr/include/linux/ntsync.h
cd /work
MAJOR=${V%%.*}; [ "$MAJOR" -ge 10 ] && SRC="https://dl.winehq.org/wine/source/$MAJOR.0/wine-$V.tar.xz"
[ -d "wine-$V" ] || { wget -q "$SRC"; tar xf "wine-$V.tar.xz"; }
rm -rf build && mkdir build && cd build
"../wine-$V/configure" --prefix=/home/isle/wine-ntsync --enable-archs=i386,x86_64 --disable-tests \
  --without-x --without-wayland --without-alsa --without-pulse --without-oss --without-cups --without-sane \
  --without-gphoto --without-v4l2 --without-vulkan --without-opengl --without-osmesa --without-gstreamer \
  --without-krb5 --without-pcap --without-usb --without-capi --without-sdl --without-ffmpeg > configure.out 2>&1
grep -q "HAVE_LINUX_NTSYNC_H 1" include/config.h || { echo "no ntsync in the configuration"; exit 1; }
make -j"$(nproc)" > make.out 2>&1
rm -rf /dst/root && make install DESTDIR=/dst/root > install.out 2>&1
find /dst/root -type f \( -name "*.so" -o -path "*/bin/*" \) -exec strip --strip-debug {} + 2>/dev/null || true
find /dst/root -type f -path "*x86_64-windows*" -exec x86_64-w64-mingw32-strip --strip-debug {} + 2>/dev/null || true
find /dst/root -type f -path "*i386-windows*" -exec i686-w64-mingw32-strip --strip-debug {} + 2>/dev/null || true
cd /dst/root && tar czf "/dst/wine-ntsync-$V.tar.gz" home/isle/wine-ntsync
chown -R "$OWNER" /dst /work
echo "built: /dst/wine-ntsync-$V.tar.gz"'
