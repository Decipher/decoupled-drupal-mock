#!/usr/bin/env bash
# Installs a pinned Vale and the ai-tells style package, both checksum-verified.
#
# Usage: install-vale.sh <bin-dir> [<styles-dir>]
#
# Why not `vale sync`: it fetches whatever the package URL serves and verifies
# nothing. Here the version and its checksum move together, so a bump is a
# reviewed change rather than something that happens inside a job.
#
# Environment:
#   VALE_VERSION       pinned below. Overriding it requires VALE_SHA256 too,
#                      because the pinned checksums are for the pinned version.
#   VALE_SHA256        expected checksum of the Vale archive for this platform.
#   AI_TELLS_VERSION   pinned below. Same rule: override both or neither.
#   AI_TELLS_SHA256    expected checksum of the style package archive.
#
# Exit codes: 0 installed, 1 checksum mismatch, 2 cannot run.

set -euo pipefail

bin_dir="${1:?usage: install-vale.sh <bin-dir> [<styles-dir>]}"
styles_dir="${2:-}"

pinned_vale="3.17.1"
pinned_ai_tells="1.31.0"
pinned_ai_tells_sha256="bc1267248f13e65928475c439ad7ae1bf806a20d09254c08d7d8c4a9c8b811f0"

vale_version="${VALE_VERSION:-$pinned_vale}"
ai_tells_version="${AI_TELLS_VERSION:-$pinned_ai_tells}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    asset="Linux_64-bit"
    pinned_vale_sha256="db947f89f2292e6a0381a61de155f6a5f5cb4cb460ca178ea412ef605559cefd" ;;
  Linux-aarch64|Linux-arm64)
    asset="Linux_arm64"
    pinned_vale_sha256="92d91ebf9ee69ec077379be95cd09e6710ab33d3d5bab66bb482e66ebc80dc23" ;;
  Darwin-x86_64)
    asset="macOS_64-bit"
    pinned_vale_sha256="b37ab999dfd1414d041bd2e94ced103292d634da76f954c385bf789dc7f5f939" ;;
  Darwin-arm64)
    asset="macOS_arm64"
    pinned_vale_sha256="80cacf85ef23f53cfdd77355ec41a6ef99aec136f15dfb3517723482f35593f9" ;;
  *)
    echo "Unsupported platform: $(uname -s) $(uname -m)" >&2
    exit 2 ;;
esac

if [ "$vale_version" != "$pinned_vale" ] && [ -z "${VALE_SHA256:-}" ]; then
  echo "VALE_VERSION=${vale_version} is not the pinned ${pinned_vale}; set VALE_SHA256 for it." >&2
  exit 2
fi
if [ "$ai_tells_version" != "$pinned_ai_tells" ] && [ -z "${AI_TELLS_SHA256:-}" ]; then
  echo "AI_TELLS_VERSION=${ai_tells_version} is not the pinned ${pinned_ai_tells}; set AI_TELLS_SHA256 for it." >&2
  exit 2
fi
vale_sha256="${VALE_SHA256:-$pinned_vale_sha256}"
ai_tells_sha256="${AI_TELLS_SHA256:-$pinned_ai_tells_sha256}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# `sha256sum` on Linux, `shasum` on macOS. Either way the comparison is
# exact, and a mismatch removes the download so nothing later can run it.
verify() {
  local file="$1" expected="$2" actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | cut -d' ' -f1)"
  else
    actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "checksum mismatch for $(basename "$file"): expected ${expected}, got ${actual}; refusing to install it." >&2
    rm -f "$file"
    return 1
  fi
}

fetch() {
  curl -sSfL --retry 3 -o "$2" "$1"
}

# --- Vale --------------------------------------------------------------------

# A cached binary is never trusted, or even run: any pipeline that can write the
# cache could leave something else there. The verified archive is what is kept,
# checked again on every run, and the binary is unpacked from it each time.
archive="$bin_dir/vale_${vale_version}_${asset}.tar.gz"
mkdir -p "$bin_dir"
if [ ! -f "$archive" ] || ! verify "$archive" "$vale_sha256" 2>/dev/null; then
  fetch "https://github.com/errata-ai/vale/releases/download/v${vale_version}/vale_${vale_version}_${asset}.tar.gz" "$archive"
  verify "$archive" "$vale_sha256" || exit 1
fi
tar -xzf "$archive" -C "$work" vale
install -m 0755 "$work/vale" "$bin_dir/vale"
echo "vale ${vale_version} installed in ${bin_dir} from its verified archive"

# --- ai-tells ----------------------------------------------------------------

if [ -z "$styles_dir" ]; then
  exit 0
fi

# The same for the styles, which can hold script rules Vale runs: the verified
# package is kept and checked on every run, and the styles unpacked from it.
zip="$styles_dir/ai-tells-${ai_tells_version}.zip"
mkdir -p "$styles_dir"
if [ ! -f "$zip" ] || ! verify "$zip" "$ai_tells_sha256" 2>/dev/null; then
  fetch "https://github.com/tbhb/vale-ai-tells/releases/download/v${ai_tells_version}/ai-tells.zip" "$zip"
  verify "$zip" "$ai_tells_sha256" || exit 1
fi

# The package is a zip. Not every image has unzip, and every image that runs
# this has one of the others.
if command -v unzip >/dev/null 2>&1; then
  unzip -q -o "$zip" -d "$work/unpacked"
elif command -v python3 >/dev/null 2>&1; then
  python3 -m zipfile -e "$zip" "$work/unpacked"
elif command -v bsdtar >/dev/null 2>&1; then
  mkdir -p "$work/unpacked" && bsdtar -xf "$zip" -C "$work/unpacked"
else
  echo "No unzip, python3 or bsdtar available to unpack the style package." >&2
  exit 2
fi

if [ ! -d "$work/unpacked/ai-tells/styles/ai-tells" ]; then
  echo "The style package did not contain styles/ai-tells; its layout has changed." >&2
  exit 2
fi
rm -rf "$styles_dir/ai-tells"
cp -R "$work/unpacked/ai-tells/styles/ai-tells" "$styles_dir/ai-tells"
echo "ai-tells ${ai_tells_version} installed in ${styles_dir} from its verified package"
