#!/usr/bin/env bash
# Build PixelDeity.apk — a native Android app wrapping the game engine.
# No Gradle, no Android Studio: just build-tools + platform android.jar + a JDK.
#
# Requirements:
#   ANDROID_BT  = path to Android build-tools 34.x (aapt2, d8, zipalign, apksigner)
#   ANDROID_JAR = path to platforms/android-34/android.jar
#   JDK 17+ on PATH (javac, keytool)
#
# Usage: ./build-apk.sh [output.apk]
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd .. && pwd)"
OUT="${1:-$REPO/dist/PixelDeity.apk}"
BT="${ANDROID_BT:?set ANDROID_BT to build-tools dir}"
AJ="${ANDROID_JAR:?set ANDROID_JAR to android.jar}"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

echo "==> assets"
mkdir -p "$BUILD/assets/js"
cp "$REPO/index.html" "$REPO/styles.css" "$BUILD/assets/"
cp "$REPO"/js/*.js "$BUILD/assets/js/"

echo "==> resources"
mkdir -p "$BUILD/flat"
"$BT/aapt2" compile res/drawable/icon.png -o "$BUILD/flat"

echo "==> link"
"$BT/aapt2" link \
  -I "$AJ" \
  --manifest AndroidManifest.xml \
  -A "$BUILD/assets" \
  "$BUILD"/flat/*.flat \
  -o "$BUILD/base.apk"

echo "==> java"
mkdir -p "$BUILD/classes"
javac --release 11 -classpath "$AJ" -d "$BUILD/classes" MainActivity.java

echo "==> dex"
mkdir -p "$BUILD/dex"
"$BT/d8" --release --lib "$AJ" --min-api 26 \
  --output "$BUILD/dex" \
  "$BUILD"/classes/dev/pixeldeity/app/*.class
(cd "$BUILD/dex" && zip -q -j "$BUILD/base.apk" classes.dex)

echo "==> align + sign"
"$BT/zipalign" -f 4 "$BUILD/base.apk" "$BUILD/aligned.apk"
if [ ! -f pixeldeity.keystore ]; then
  keytool -genkeypair -keystore pixeldeity.keystore -alias pixeldeity \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass pixeldeity -keypass pixeldeity \
    -dname "CN=Pixel Deity, OU=Divine, O=PixelDeity"
fi
mkdir -p "$(dirname "$OUT")"
"$BT/apksigner" sign --ks pixeldeity.keystore \
  --ks-pass pass:pixeldeity --key-pass pass:pixeldeity \
  --out "$OUT" "$BUILD/aligned.apk"
"$BT/apksigner" verify "$OUT"
echo "==> built $OUT ($(du -h "$OUT" | cut -f1))"
