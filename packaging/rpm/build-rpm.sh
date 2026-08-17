#!/bin/bash
# Build the ExtensionInstallForcelist policy RPM.
#
# Falls back to building inside a Fedora container when rpmbuild is not
# installed, which is the normal case on a workstation that is not itself an
# RPM distribution.
#
#   packaging/rpm/build-rpm.sh --key key.pem
#   packaging/rpm/build-rpm.sh --id <32-char-id> --url https://x.github.io/y/update.xml
#
# With neither --url nor --pages-url, the update URL is derived from the
# 'origin' git remote on the assumption that GitHub Pages serves the repo at
# https://<owner>.github.io/<repo>/.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPEC="$REPO_ROOT/packaging/rpm/ublock-mv3-policy.spec"

EXT_ID=""
KEY_FILE=""
UPDATE_URL=""
PAGES_URL=""
VERSION=""
BROWSERS=""
OUTDIR="$REPO_ROOT/dist/build"
IMAGE="registry.fedoraproject.org/fedora:41"

die() { echo "error: $*" >&2; exit 1; }

usage() {
	sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; $d'
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--id)        EXT_ID="$2"; shift 2 ;;
		--key)       KEY_FILE="$2"; shift 2 ;;
		--url)       UPDATE_URL="$2"; shift 2 ;;
		--pages-url) PAGES_URL="$2"; shift 2 ;;
		--version)   VERSION="$2"; shift 2 ;;
		--browsers)  BROWSERS="$2"; shift 2 ;;
		--outdir)    OUTDIR="$2"; shift 2 ;;
		--image)     IMAGE="$2"; shift 2 ;;
		-h|--help)   usage 0 ;;
		*)           die "unknown argument: $1 (try --help)" ;;
	esac
done

# --- extension id -----------------------------------------------------------

if [[ -z "$EXT_ID" && -n "$KEY_FILE" ]]; then
	[[ -f "$KEY_FILE" ]] || die "no such key file: $KEY_FILE"
	EXT_ID="$("$REPO_ROOT/tools/crx-id.sh" "$KEY_FILE")"
	echo "derived extension id from $KEY_FILE"
fi
[[ -n "$EXT_ID" ]] || die "need --id <32-char-id> or --key <key.pem>"

# A wrong ID produces a policy the browser accepts and then quietly does
# nothing with, so check the shape up front.
[[ "$EXT_ID" =~ ^[a-p]{32}$ ]] \
	|| die "'$EXT_ID' is not a valid extension id (32 characters, a-p only)"

# --- update url -------------------------------------------------------------

if [[ -z "$UPDATE_URL" ]]; then
	if [[ -z "$PAGES_URL" ]]; then
		remote="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
		[[ -n "$remote" ]] || die "no git remote 'origin'; pass --url explicitly"
		slug="$(printf '%s' "$remote" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
		[[ "$slug" == */* ]] || die "cannot parse GitHub slug from '$remote'; pass --url"
		# GitHub Pages serves the owner as a lowercase hostname label; the
		# repository path keeps its original case.
		owner="$(printf '%s' "${slug%%/*}" | tr '[:upper:]' '[:lower:]')"
		PAGES_URL="$owner.github.io/${slug#*/}"
		echo "derived pages url from origin: https://$PAGES_URL/"
	fi
	UPDATE_URL="https://${PAGES_URL#https://}"
	UPDATE_URL="${UPDATE_URL%/}/update.xml"
fi

[[ "$UPDATE_URL" == https://* ]] \
	|| die "update url must be https (browsers reject plain http): $UPDATE_URL"

[[ -z "$VERSION" ]] && VERSION="$(cat "$REPO_ROOT/dist/version")"

echo "extension id : $EXT_ID"
echo "update url   : $UPDATE_URL"
echo "version      : $VERSION"

# --- build ------------------------------------------------------------------

mkdir -p "$OUTDIR"

defines=(
	--define "extid $EXT_ID"
	--define "update_url $UPDATE_URL"
	--define "pkgversion $VERSION"
)
[[ -n "$BROWSERS" ]] && defines+=(--define "browsers $BROWSERS")

if command -v rpmbuild >/dev/null 2>&1; then
	echo "building with local rpmbuild"
	rpmbuild -bb "$SPEC" \
		--define "_topdir $OUTDIR/rpmbuild" \
		--define "_rpmdir $OUTDIR" \
		--define "_build_name_fmt %%{NAME}-%%{VERSION}-%%{RELEASE}.%%{ARCH}.rpm" \
		"${defines[@]}"
else
	runtime=""
	for r in podman docker; do
		command -v "$r" >/dev/null 2>&1 && { runtime="$r"; break; }
	done
	[[ -n "$runtime" ]] \
		|| die "no rpmbuild, and neither podman nor docker is available"

	echo "no local rpmbuild; building in $IMAGE via $runtime"
	# Quote the defines for the shell inside the container. The values are
	# already validated above, so this is shape-preserving rather than a
	# security boundary.
	inner_defines=""
	for ((i = 0; i < ${#defines[@]}; i += 2)); do
		inner_defines+=" --define '${defines[i+1]}'"
	done

	"$runtime" run --rm \
		-v "$REPO_ROOT:/src:ro" \
		-v "$OUTDIR:/out:rw" \
		--security-opt label=disable \
		"$IMAGE" \
		bash -euo pipefail -c "
			dnf install -q -y rpm-build python3 >/dev/null
			rpmbuild -bb /src/packaging/rpm/ublock-mv3-policy.spec \
				--define '_topdir /tmp/rpmbuild' \
				--define '_rpmdir /out' \
				--define '_build_name_fmt %%{NAME}-%%{VERSION}-%%{RELEASE}.%%{ARCH}.rpm' \
				$inner_defines
		"
fi

RPM="$(ls -t "$OUTDIR"/ublock-mv3-policy-*.rpm 2>/dev/null | head -1)"
[[ -n "$RPM" ]] || die "build reported success but produced no rpm"

echo
echo "built: $RPM"
echo
if command -v rpm >/dev/null 2>&1; then
	rpm -qlp "$RPM"
fi
